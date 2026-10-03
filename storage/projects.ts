import { getDB, newId, requestPersistentStorage, type HistoryRecord, type ProjectRecord } from "./indexedDB";
import { defaultRecipe, normalizeRecipe, type EditRecipe } from "@/types/edit";
import { readMetadata } from "@/lib/imageMetadata";
import { baseName, probeDimensions, RAW_FORMATS, sniffFormat, type SniffedFormat } from "@/lib/fileUtils";
import { baseLayer, collectAssetIds, normalizeLayers, type LayerDoc } from "@/types/layers";
import { putAsset, getAsset, deleteAsset } from "./assets";

export type ProjectSummary = Pick<
  ProjectRecord,
  "id" | "name" | "createdAt" | "modifiedAt" | "width" | "height" | "origin" | "sourceName"
>;

/**
 * Create a project from an original file. The original bytes are stored as-is
 * (never re-encoded); all edits live in the recipe.
 */
export async function createProjectFromFile(
  file: Blob,
  opts: { name?: string; origin?: "import" | "camera"; recipe?: EditRecipe; format?: SniffedFormat } = {},
): Promise<ProjectRecord> {
  const fileName = (file as File).name ?? opts.name ?? "photo";
  const format = opts.format ?? (await sniffFormat(file, fileName));
  const [dims, exif] = await Promise.all([probeDimensions(file, format), readMetadata(file)]);
  // RAW: fill gaps from LibRaw's own metadata parser (EXIF parsers miss some formats, e.g. CR3/RAF).
  let metadata = exif;
  if (RAW_FORMATS.includes(format)) {
    const { readRawMetadata } = await import("@/engine/raw/libraw");
    const rawMeta = await readRawMetadata(file);
    if (rawMeta) metadata = { ...rawMeta, ...Object.fromEntries(Object.entries(exif ?? {}).filter(([, v]) => v !== undefined)) } as typeof exif;
  }
  const asset = await putAsset(file, fileName);
  const now = Date.now();
  const project: ProjectRecord = {
    id: newId(),
    name: opts.name ?? baseName(fileName),
    createdAt: now,
    modifiedAt: now,
    origin: opts.origin ?? "import",
    sourceAssetId: asset.id,
    sourceName: fileName,
    sourceType: file.type || `image/${format}`,
    sourceSize: file.size,
    width: dims.width,
    height: dims.height,
    recipe: opts.recipe ?? defaultRecipe(),
    layers: [baseLayer()],
    metadata,
  };
  const db = await getDB();
  await db.put("projects", project);
  void requestPersistentStorage();
  return project;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("projects", "modifiedAt");
  return all.reverse().map(({ id, name, createdAt, modifiedAt, width, height, origin, sourceName }) => ({
    id,
    name,
    createdAt,
    modifiedAt,
    width,
    height,
    origin,
    sourceName,
  }));
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  const db = await getDB();
  const p = await db.get("projects", id);
  if (!p) return undefined;
  return { ...p, recipe: normalizeRecipe(p.recipe), layers: normalizeLayers(p.layers ?? []) };
}

export async function saveProjectState(
  id: string,
  state: { recipe: EditRecipe; layers: LayerDoc[]; history?: HistoryRecord; thumbnail?: Blob },
): Promise<void> {
  const db = await getDB();
  // Read the thumbnail bytes before opening the transaction (awaiting non-IDB work would auto-commit it).
  const thumb = state.thumbnail ? { bytes: await state.thumbnail.arrayBuffer(), type: state.thumbnail.type } : null;
  const tx = db.transaction(["projects", "history", "thumbnails"], "readwrite");
  const p = await tx.objectStore("projects").get(id);
  if (!p) throw new Error("Project no longer exists.");
  p.recipe = state.recipe;
  p.layers = state.layers;
  p.modifiedAt = Date.now();
  await tx.objectStore("projects").put(p);
  if (state.history) await tx.objectStore("history").put(state.history);
  if (thumb) await tx.objectStore("thumbnails").put({ projectId: id, ...thumb });
  await tx.done;
}

export async function getHistory(id: string): Promise<HistoryRecord | undefined> {
  return (await getDB()).get("history", id);
}

export async function getThumbnail(id: string): Promise<Blob | undefined> {
  const t = await (await getDB()).get("thumbnails", id);
  if (!t) return undefined;
  return t.blob ?? (t.bytes ? new Blob([t.bytes], { type: t.type ?? "image/jpeg" }) : undefined);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const db = await getDB();
  const p = await db.get("projects", id);
  if (!p) return;
  p.name = name.trim().slice(0, 120) || p.name;
  p.modifiedAt = Date.now();
  await db.put("projects", p);
}

export async function duplicateProject(id: string): Promise<ProjectRecord | undefined> {
  const db = await getDB();
  const p = await db.get("projects", id);
  if (!p) return undefined;
  const now = Date.now();
  // The original asset is shared by reference (it is immutable), so duplication costs no image copy.
  const copy: ProjectRecord = {
    ...structuredClone(p),
    id: newId(),
    name: `${p.name} copy`,
    createdAt: now,
    modifiedAt: now,
  };
  await db.put("projects", copy);
  const thumb = await db.get("thumbnails", id);
  if (thumb) await db.put("thumbnails", { ...thumb, projectId: copy.id });
  return copy;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  const p = await db.get("projects", id);
  if (!p) return;
  const tx = db.transaction(["projects", "history", "thumbnails"], "readwrite");
  await Promise.all([
    tx.objectStore("projects").delete(id),
    tx.objectStore("history").delete(id),
    tx.objectStore("thumbnails").delete(id),
  ]);
  await tx.done;
  // Garbage-collect assets no other project references.
  const others = await db.getAll("projects");
  const referenced = new Set<string>();
  for (const o of others) {
    referenced.add(o.sourceAssetId);
    for (const id of collectAssetIds(o.layers ?? [])) referenced.add(id);
  }
  const owned = [p.sourceAssetId, ...collectAssetIds(p.layers ?? [])];
  for (const a of owned) if (a && !referenced.has(a)) await deleteAsset(a);
}

export async function getProjectSource(project: ProjectRecord): Promise<Blob> {
  const asset = await getAsset(project.sourceAssetId);
  if (!asset) throw new Error("The original image for this project is missing from local storage.");
  return asset.blob;
}
