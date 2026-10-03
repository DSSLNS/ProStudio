/**
 * The .prostudio project file: a ZIP container (no compression for image data,
 * which is already compressed) holding
 *   project.json   — metadata, recipe, layers, history (JSON only, no code)
 *   assets/<id>    — original image bytes and layer/mask assets, byte-for-byte
 * Import validates everything; nothing inside a project file is ever executed.
 */
import { zip, unzip, strToU8, strFromU8, type Zippable } from "fflate";
import { getDB, newId, type ProjectRecord } from "./indexedDB";
import { getAsset, putAsset } from "./assets";
import { normalizeRecipe } from "@/types/edit";
import { collectAssetIds, fixLayerStack, normalizeLayer, normalizeLayers, type LayerDoc } from "@/types/layers";
import { getHistory } from "./projects";

const FORMAT = "prostudio-project";
/** v2 adds layers (with a de-duplicated layer table for history). v1 files still import. */
const FORMAT_VERSION = 2;
const MAX_PROJECT_JSON = 20 * 1024 * 1024;

interface ProjectFileJson {
  format: typeof FORMAT;
  version: number;
  project: Omit<ProjectRecord, "id">;
  /** v1: entries carry `layers`; v2: entries carry `layerRefs` into `layerTable`. */
  history?: {
    entries: { label: string; recipe: unknown; at: number; layers?: unknown[]; layerRefs?: number[] }[];
    index: number;
  };
  layerTable?: unknown[];
  assets: { id: string; name: string; type: string }[];
}

export async function exportProjectFile(project: ProjectRecord): Promise<Blob> {
  const history = await getHistory(project.id);
  const assetIds = new Set<string>([project.sourceAssetId, ...collectAssetIds(project.layers)]);
  for (const e of history?.entries ?? []) for (const id of collectAssetIds(e.layers)) assetIds.add(id);
  const files: Zippable = {};
  const assetMeta: ProjectFileJson["assets"] = [];
  for (const id of assetIds) {
    const a = await getAsset(id);
    if (!a) continue;
    files[`assets/${id}`] = [new Uint8Array(await a.blob.arrayBuffer()), { level: 0 }];
    assetMeta.push({ id, name: a.name, type: a.type });
  }
  // Layers are immutable and shared between history entries; store each distinct object once.
  const table: LayerDoc[] = [];
  const index = new Map<LayerDoc, number>();
  const ref = (l: LayerDoc) => {
    let i = index.get(l);
    if (i === undefined) {
      i = table.push(l) - 1;
      index.set(l, i);
    }
    return i;
  };
  const historyJson = history
    ? {
        entries: history.entries.map((e) => ({
          label: e.label,
          recipe: e.recipe,
          at: e.at,
          layerRefs: e.layers.map(ref),
        })),
        index: history.index,
      }
    : undefined;
  const { id: _omit, ...rest } = project;
  void _omit;
  const json: ProjectFileJson = {
    format: FORMAT,
    version: FORMAT_VERSION,
    project: rest,
    history: historyJson,
    layerTable: table,
    assets: assetMeta,
  };
  // project.json goes first so the file can be identified from its first bytes.
  const ordered: Zippable = { "project.json": [strToU8(JSON.stringify(json)), { level: 6 }], ...files };
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(ordered, (err, out) => (err ? reject(err) : resolve(out))),
  );
  return new Blob([data as BlobPart], { type: "application/x-prostudio" });
}

export class ProjectImportError extends Error {}

export async function importProjectFile(file: Blob): Promise<ProjectRecord> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = await new Promise((resolve, reject) => unzip(bytes, (err, out) => (err ? reject(err) : resolve(out))));
  } catch {
    throw new ProjectImportError("This file is not a valid ProStudio project (could not unpack it).");
  }
  const raw = entries["project.json"];
  if (!raw || raw.length > MAX_PROJECT_JSON) throw new ProjectImportError("The project file is missing project.json.");
  let json: ProjectFileJson;
  try {
    json = JSON.parse(strFromU8(raw)) as ProjectFileJson;
  } catch {
    throw new ProjectImportError("The project data is corrupt.");
  }
  if (json.format !== FORMAT || typeof json.version !== "number")
    throw new ProjectImportError("Not a ProStudio project file.");
  if (json.version > FORMAT_VERSION)
    throw new ProjectImportError("This project was created by a newer version of ProStudio.");

  // Re-key assets so importing the same file twice never collides.
  const assetMap = new Map<string, string>();
  for (const a of json.assets ?? []) {
    if (typeof a?.id !== "string") continue;
    const data = entries[`assets/${a.id}`];
    if (!data) continue;
    const type = typeof a.type === "string" && /^image\/[\w.+-]+$/.test(a.type) ? a.type : "application/octet-stream";
    const rec = await putAsset(new Blob([data as BlobPart], { type }), typeof a.name === "string" ? a.name : "asset");
    assetMap.set(a.id, rec.id);
  }
  const p = json.project;
  const remap = (id: unknown) => (typeof id === "string" ? (assetMap.get(id) ?? null) : null);
  const sourceAssetId = assetMap.get(p?.sourceAssetId);
  if (!sourceAssetId) throw new ProjectImportError("The project's original image is missing from the file.");
  const now = Date.now();
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const project: ProjectRecord = {
    id: newId(),
    name: typeof p.name === "string" ? p.name.slice(0, 120) : "Imported project",
    createdAt: num(p.createdAt, now),
    modifiedAt: now,
    origin: p.origin === "camera" ? "camera" : "import",
    sourceAssetId,
    sourceName: typeof p.sourceName === "string" ? p.sourceName.slice(0, 255) : "original",
    sourceType: typeof p.sourceType === "string" ? p.sourceType : "",
    sourceSize: num(p.sourceSize, 0),
    width: num(p.width, 0),
    height: num(p.height, 0),
    recipe: normalizeRecipe(p.recipe),
    layers: normalizeLayers(p.layers, remap),
    metadata: p.metadata && typeof p.metadata === "object" ? p.metadata : null,
  };
  const db = await getDB();
  await db.put("projects", project);
  if (json.history && Array.isArray(json.history.entries)) {
    // Normalise each distinct table layer once so history entries keep sharing objects.
    const table = (Array.isArray(json.layerTable) ? json.layerTable.slice(0, 100_000) : []).map((l) =>
      normalizeLayer(l, remap),
    );
    const entries = json.history.entries.slice(-200).map((e) => ({
      label: typeof e.label === "string" ? e.label.slice(0, 80) : "Edit",
      recipe: normalizeRecipe(e.recipe),
      layers: Array.isArray(e.layerRefs)
        ? fixLayerStack(e.layerRefs.map((i) => (typeof i === "number" ? table[i] : null)))
        : normalizeLayers(e.layers, remap),
      at: num(e.at, now),
    }));
    if (entries.length) {
      await db.put("history", {
        projectId: project.id,
        entries,
        index: Math.max(0, Math.min(entries.length - 1, num(json.history.index, entries.length - 1))),
      });
    }
  }
  return project;
}
