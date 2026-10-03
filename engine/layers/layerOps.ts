/**
 * Pure, immutable layer-stack operations. Array order = z-order (index 0 bottom);
 * `parentId` = group membership (children need not be contiguous).
 */
import {
  BASE_LAYER_ID,
  defaultAdjustment,
  emptyMask,
  type AdjustmentLayer,
  type GroupLayer,
  type LayerDoc,
  type MaskDoc,
  type PaintLayer,
  type RetouchLayer,
  type ShapeLayer,
  type TextLayer,
  type ImageLayer,
  type Placement,
} from "@/types/layers";

export const newLayerId = () => `l_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

const common = (name: string) => ({
  id: newLayerId(),
  name,
  visible: true,
  locked: false,
  opacity: 100,
  blendMode: "normal" as const,
  mask: null,
  maskEnabled: true,
  maskFeather: 0,
  parentId: null,
});

export function uniqueName(layers: LayerDoc[], base: string): string {
  const names = new Set(layers.map((l) => l.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export const makeImageLayer = (name: string, assetId: string, placement: Placement): ImageLayer => ({
  ...common(name),
  kind: "image",
  assetId,
  placement,
});

export const makeTextLayer = (name: string, placement: Placement, fontSize: number): TextLayer => ({
  ...common(name),
  kind: "text",
  text: "Text",
  fontFamily: "system-ui, sans-serif",
  fontSize,
  fontWeight: 600,
  color: "#ffffff",
  align: "center",
  placement,
});

export const makeShapeLayer = (name: string, shape: ShapeLayer["shape"], placement: Placement): ShapeLayer => ({
  ...common(name),
  kind: "shape",
  shape,
  fill: "#ffffff",
  stroke: null,
  strokeWidth: 0,
  placement,
});

export const makeAdjustmentLayer = (name: string): AdjustmentLayer => ({
  ...common(name),
  kind: "adjustment",
  adjustment: defaultAdjustment(),
});

export const makeGroupLayer = (name: string): GroupLayer => ({ ...common(name), kind: "group", collapsed: false });
export const makePaintLayer = (name: string): PaintLayer => ({ ...common(name), kind: "paint", ops: [] });
export const makeRetouchLayer = (name: string): RetouchLayer => ({ ...common(name), kind: "retouch", ops: [] });

export function findLayer(layers: LayerDoc[], id: string): LayerDoc | undefined {
  return layers.find((l) => l.id === id);
}

/** Ids of `id` and all its descendants. */
export function subtreeIds(layers: LayerDoc[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of layers) {
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Insert `layer` directly above `aboveId` (into it, if it is an expanded group), or at the top. */
export function insertLayer(layers: LayerDoc[], layer: LayerDoc, aboveId?: string | null): LayerDoc[] {
  const target = aboveId ? findLayer(layers, aboveId) : undefined;
  if (!target) return [...layers, { ...layer, parentId: null }];
  const parentId = target.kind === "group" && !target.collapsed ? target.id : target.parentId;
  const sub = subtreeIds(layers, target.id);
  const at = Math.max(...layers.map((l, i) => (sub.has(l.id) ? i : -1))) + 1;
  return [...layers.slice(0, at), { ...layer, parentId }, ...layers.slice(at)];
}

export type LayerPatch = Partial<LayerDoc>;

export function patchLayer(
  layers: LayerDoc[],
  id: string,
  patch: LayerPatch | ((l: LayerDoc) => LayerPatch),
): LayerDoc[] {
  return layers.map((l) =>
    l.id === id ? ({ ...l, ...(typeof patch === "function" ? patch(l) : patch) } as LayerDoc) : l,
  );
}

export function removeLayer(layers: LayerDoc[], id: string): LayerDoc[] {
  if (id === BASE_LAYER_ID) return layers;
  const ids = subtreeIds(layers, id);
  return layers.filter((l) => !ids.has(l.id));
}

/** Duplicate a layer (and, for groups, its whole subtree) directly above it. */
export function duplicateLayer(layers: LayerDoc[], id: string): { layers: LayerDoc[]; newId: string | null } {
  const src = findLayer(layers, id);
  if (!src || src.kind === "base") return { layers, newId: null };
  const ids = subtreeIds(layers, id);
  const remap = new Map<string, string>();
  for (const i of ids) remap.set(i, newLayerId());
  const copies = layers
    .filter((l) => ids.has(l.id))
    .map((l) => ({
      ...l,
      id: remap.get(l.id)!,
      name: l.id === id ? uniqueName(layers, `${l.name} copy`) : l.name,
      parentId: l.parentId && remap.has(l.parentId) ? remap.get(l.parentId)! : l.parentId,
    })) as LayerDoc[];
  const lastIdx = Math.max(...layers.map((l, i) => (ids.has(l.id) ? i : -1)));
  return { layers: [...layers.slice(0, lastIdx + 1), ...copies, ...layers.slice(lastIdx + 1)], newId: remap.get(id)! };
}

export type DropPosition = "above" | "below" | "inside";

/** Move a layer relative to another (drag-and-drop). Invalid moves return the input unchanged. */
export function moveLayer(layers: LayerDoc[], id: string, targetId: string, position: DropPosition): LayerDoc[] {
  if (id === BASE_LAYER_ID || id === targetId) return layers;
  const moving = findLayer(layers, id);
  const target = findLayer(layers, targetId);
  if (!moving || !target) return layers;
  const sub = subtreeIds(layers, id);
  if (sub.has(targetId)) return layers; // can't drop into own subtree
  if (position === "inside" && target.kind !== "group") position = "above";
  if (target.kind === "base" && position !== "above") position = "above";
  const rest = layers.filter((l) => l.id !== id);
  const tIdx = rest.findIndex((l) => l.id === targetId);
  let at: number;
  let parentId: string | null;
  if (position === "inside") {
    parentId = target.id;
    const tsub = subtreeIds(rest, target.id);
    at = Math.max(...rest.map((l, i) => (tsub.has(l.id) ? i : -1))) + 1;
  } else if (position === "above") {
    parentId = target.parentId;
    const tsub = target.kind === "group" ? subtreeIds(rest, target.id) : new Set([target.id]);
    at = Math.max(...rest.map((l, i) => (tsub.has(l.id) ? i : -1))) + 1;
  } else {
    parentId = target.parentId;
    at = tIdx;
  }
  at = Math.max(1, at); // never below the base layer
  return [...rest.slice(0, at), { ...moving, parentId }, ...rest.slice(at)];
}

/** Siblings of a layer in z-order (bottom → top). */
export function siblings(layers: LayerDoc[], id: string): LayerDoc[] {
  const l = findLayer(layers, id);
  if (!l) return [];
  return layers.filter((x) => x.parentId === l.parentId && x.kind !== "base");
}

/** Move one step up/down among siblings (keyboard / buttons). */
export function nudgeLayer(layers: LayerDoc[], id: string, dir: 1 | -1): LayerDoc[] {
  const sibs = siblings(layers, id);
  const i = sibs.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return layers;
  return moveLayer(layers, id, sibs[j].id, dir === 1 ? "above" : "below");
}

/** Wrap a layer in a new group at its position. */
export function groupLayer(
  layers: LayerDoc[],
  id: string,
  name: string,
): { layers: LayerDoc[]; groupId: string | null } {
  const l = findLayer(layers, id);
  if (!l || l.kind === "base") return { layers, groupId: null };
  const g = { ...makeGroupLayer(name), parentId: l.parentId };
  const idx = layers.indexOf(l);
  const withGroup = [...layers.slice(0, idx), g, ...layers.slice(idx)];
  return { layers: withGroup.map((x) => (x.id === id ? { ...x, parentId: g.id } : x)), groupId: g.id };
}

/** Remove a group, moving its children up one level. */
export function ungroupLayer(layers: LayerDoc[], id: string): LayerDoc[] {
  const g = findLayer(layers, id);
  if (!g || g.kind !== "group") return layers;
  return layers.filter((l) => l.id !== id).map((l) => (l.parentId === id ? { ...l, parentId: g.parentId } : l));
}

/** Visible-tree display order: top-most first, with depth, honouring collapsed groups. */
export function displayRows(layers: LayerDoc[]): { layer: LayerDoc; depth: number }[] {
  const rows: { layer: LayerDoc; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const kids = layers.filter((l) => l.parentId === parentId);
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      rows.push({ layer: k, depth });
      if (k.kind === "group" && !k.collapsed) walk(k.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export function addMask(layers: LayerDoc[], id: string, mask: MaskDoc = emptyMask(1)): LayerDoc[] {
  return patchLayer(layers, id, { mask, maskEnabled: true });
}

/** Append mask ops, creating a reveal-all mask first if needed. */
export function appendMaskOps(layers: LayerDoc[], id: string, ops: MaskDoc["ops"]): LayerDoc[] {
  return patchLayer(layers, id, (l) => ({
    mask: { ...(l.mask ?? emptyMask(1)), ops: [...(l.mask?.ops ?? []), ...ops] },
    maskEnabled: true,
  }));
}
