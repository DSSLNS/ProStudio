/**
 * Layer document model.
 *
 * Coordinates: all layer geometry, mask operations and brush strokes are in
 * FRAME PIXELS — full-resolution pixels of the warped frame (after rotation,
 * straighten, perspective…, before crop). Changing the crop therefore never
 * moves layers, and everything rasterises at any resolution (preview or full-res
 * export) without stored pixel copies.
 *
 * Layers are immutable values: edits always create new objects, so history
 * snapshots share unchanged layers/ops instead of duplicating them.
 *
 * Stack order: array index 0 is the bottom. The "base" layer (the developed
 * photo) is always index 0.
 */

export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "darken",
  "lighten",
  "difference",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: "Normal",
  multiply: "Multiply",
  screen: "Screen",
  overlay: "Overlay",
  "soft-light": "Soft Light",
  "hard-light": "Hard Light",
  darken: "Darken",
  lighten: "Lighten",
  difference: "Difference",
  color: "Color",
  luminosity: "Luminosity",
};

export type LayerKind = "base" | "image" | "text" | "shape" | "adjustment" | "group" | "paint" | "retouch";

// ---------------------------------------------------------------------------
// Masks & selections share one representation: an ordered list of operations
// composited onto a base value (0 = hidden/unselected, 1 = visible/selected).
// ---------------------------------------------------------------------------

export type CombineMode = "add" | "subtract" | "intersect" | "replace";

export interface BrushParams {
  size: number; // diameter, frame px
  hardness: number; // 0..1
  opacity: number; // 0..1 (max coverage of a stroke)
  flow: number; // 0..1 (per-dab coverage)
  spacing: number; // fraction of size between dabs
  /** Pressure modulates size (and flow) when the input device reports it. */
  pressureSize: boolean;
}

export type MaskOp =
  | { type: "rect"; mode: CombineMode; x: number; y: number; w: number; h: number }
  | { type: "ellipse"; mode: CombineMode; cx: number; cy: number; rx: number; ry: number }
  | { type: "polygon"; mode: CombineMode; points: number[] } // x,y pairs
  | { type: "stroke"; mode: CombineMode; points: number[]; brush: BrushParams; value: number } // x,y,pressure triples; value = paint level 0..1
  | { type: "gradient"; mode: CombineMode; kind: "linear" | "radial"; x0: number; y0: number; x1: number; y1: number }
  | { type: "raster"; mode: CombineMode; assetId: string; x: number; y: number; w: number; h: number }
  | { type: "mask"; mode: CombineMode; mask: MaskDoc }
  | { type: "feather"; radius: number }
  | { type: "expand"; radius: number } // negative = contract
  | { type: "invert" };

export interface MaskDoc {
  base: 0 | 1;
  ops: MaskOp[];
}

export const emptyMask = (base: 0 | 1): MaskDoc => ({ base, ops: [] });

// ---------------------------------------------------------------------------
// Paint and retouch operations
// ---------------------------------------------------------------------------

export interface PaintOp {
  tool: "brush" | "pencil" | "eraser";
  points: number[]; // x,y,pressure triples (frame px)
  brush: BrushParams;
  color: string; // #rrggbb
  /** Optional selection the stroke was clipped to. */
  clip?: MaskDoc;
}

export const RETOUCH_TOOLS = ["clone", "heal", "dodge", "burn", "smudge", "blur", "sharpen", "dust", "redeye", "skin"] as const;
export type RetouchTool = (typeof RETOUCH_TOOLS)[number];

export interface RetouchOp {
  tool: RetouchTool;
  points: number[]; // x,y,pressure triples (frame px)
  brush: BrushParams;
  /** Strength 0..1 (dodge/burn exposure, blur/sharpen amount, smudge strength). */
  strength: number;
  /** Clone / heal source offset (source = destination + offset), frame px. */
  offset?: [number, number];
  /** Dodge/burn tonal range. */
  range?: "shadows" | "midtones" | "highlights";
  /** Dust & scratches threshold (0..1). */
  threshold?: number;
  clip?: MaskDoc;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

interface LayerBase {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  blendMode: BlendMode;
  mask: MaskDoc | null;
  maskEnabled: boolean;
  /** Non-destructive feather applied after the mask ops (frame px). */
  maskFeather: number;
  parentId: string | null;
}

/** Placement of layer content in frame pixels. */
export interface Placement {
  x: number; // centre
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
}

export interface BaseLayer extends LayerBase {
  kind: "base";
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  assetId: string;
  placement: Placement;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: number; // frame px
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  placement: Placement;
}

export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: "rectangle" | "ellipse";
  fill: string | null;
  stroke: string | null;
  strokeWidth: number; // frame px
  placement: Placement;
}

export interface AdjustmentParams {
  exposure: number; // EV -4..4
  contrast: number; // -100..100
  highlights: number;
  shadows: number;
  saturation: number;
  temperature: number;
  tint: number;
  hue: number; // degrees -180..180
}

export const defaultAdjustment = (): AdjustmentParams => ({
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
});

/** Applies its adjustment to everything beneath it (within its group), through its mask. */
export interface AdjustmentLayer extends LayerBase {
  kind: "adjustment";
  adjustment: AdjustmentParams;
}

/** Isolated group: children composite together, then blend as one. */
export interface GroupLayer extends LayerBase {
  kind: "group";
  collapsed: boolean;
}

export interface PaintLayer extends LayerBase {
  kind: "paint";
  ops: PaintOp[];
}

/** Non-destructive retouching: operations re-applied to the image beneath at render time. */
export interface RetouchLayer extends LayerBase {
  kind: "retouch";
  ops: RetouchOp[];
}

export type LayerDoc =
  BaseLayer | ImageLayer | TextLayer | ShapeLayer | AdjustmentLayer | GroupLayer | PaintLayer | RetouchLayer;

export const BASE_LAYER_ID = "base";

export function baseLayer(): BaseLayer {
  return {
    id: BASE_LAYER_ID,
    name: "Background",
    kind: "base",
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: "normal",
    mask: null,
    maskEnabled: true,
    maskFeather: 0,
    parentId: null,
  };
}

/** True when the stack is just the plain base photo (fast path: no compositing needed). */
export function isTrivialStack(layers: LayerDoc[]): boolean {
  if (layers.length === 0) return true;
  if (layers.length > 1) return false;
  const b = layers[0];
  return b.kind === "base" && b.visible && b.opacity === 100 && (!b.mask || !b.maskEnabled);
}

// ---------------------------------------------------------------------------
// Validation of untrusted input (storage / imported .prostudio files)
// ---------------------------------------------------------------------------

const MAX_POINTS = 200_000;
const MAX_OPS = 5_000;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, d: number, lo = -1e7, hi = 1e7) => (isNum(v) ? Math.max(lo, Math.min(hi, v)) : d);
const color = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const MODES: CombineMode[] = ["add", "subtract", "intersect", "replace"];
const mode = (v: unknown): CombineMode => (MODES.includes(v as CombineMode) ? (v as CombineMode) : "add");
const points = (v: unknown, stride: number): number[] | null =>
  Array.isArray(v) && v.length >= stride && v.length <= MAX_POINTS && v.length % stride === 0 && v.every(isNum)
    ? (v as number[])
    : null;

export function normalizeBrush(v: unknown): BrushParams {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    size: num(o.size, 50, 0.5, 20000),
    hardness: num(o.hardness, 0.8, 0, 1),
    opacity: num(o.opacity, 1, 0, 1),
    flow: num(o.flow, 1, 0.01, 1),
    spacing: num(o.spacing, 0.15, 0.02, 2),
    pressureSize: o.pressureSize !== false,
  };
}

type AssetMap = (id: unknown) => string | null;

export function normalizeMask(v: unknown, remap: AssetMap, depth = 0): MaskDoc | null {
  if (!v || typeof v !== "object" || depth > 4) return null;
  const o = v as Record<string, unknown>;
  const ops: MaskOp[] = [];
  for (const raw of (Array.isArray(o.ops) ? o.ops : []).slice(0, MAX_OPS)) {
    const op = normalizeMaskOp(raw, remap, depth);
    if (op) ops.push(op);
  }
  return { base: o.base === 0 ? 0 : 1, ops };
}

function normalizeMaskOp(v: unknown, remap: AssetMap, depth: number): MaskOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "rect":
      return { type: "rect", mode: mode(o.mode), x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 0, 0), h: num(o.h, 0, 0) };
    case "ellipse":
      return {
        type: "ellipse",
        mode: mode(o.mode),
        cx: num(o.cx, 0),
        cy: num(o.cy, 0),
        rx: num(o.rx, 0, 0),
        ry: num(o.ry, 0, 0),
      };
    case "polygon": {
      const p = points(o.points, 2);
      return p ? { type: "polygon", mode: mode(o.mode), points: p } : null;
    }
    case "stroke": {
      const p = points(o.points, 3);
      return p
        ? {
            type: "stroke",
            mode: mode(o.mode),
            points: p,
            brush: normalizeBrush(o.brush),
            value: num(o.value, 1, 0, 1),
          }
        : null;
    }
    case "gradient":
      return {
        type: "gradient",
        mode: mode(o.mode),
        kind: o.kind === "radial" ? "radial" : "linear",
        x0: num(o.x0, 0),
        y0: num(o.y0, 0),
        x1: num(o.x1, 1),
        y1: num(o.y1, 1),
      };
    case "raster": {
      const id = remap(o.assetId);
      return id
        ? {
            type: "raster",
            mode: mode(o.mode),
            assetId: id,
            x: num(o.x, 0),
            y: num(o.y, 0),
            w: num(o.w, 1, 0),
            h: num(o.h, 1, 0),
          }
        : null;
    }
    case "mask": {
      const m = normalizeMask(o.mask, remap, depth + 1);
      return m ? { type: "mask", mode: mode(o.mode), mask: m } : null;
    }
    case "feather":
      return { type: "feather", radius: num(o.radius, 0, 0, 5000) };
    case "expand":
      return { type: "expand", radius: num(o.radius, 0, -5000, 5000) };
    case "invert":
      return { type: "invert" };
    default:
      return null;
  }
}

function normalizePlacement(v: unknown): Placement {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    x: num(o.x, 0),
    y: num(o.y, 0),
    width: num(o.width, 100, 1),
    height: num(o.height, 100, 1),
    rotation: num(o.rotation, 0, -360, 360),
  };
}

function normalizePaintOp(v: unknown, remap: AssetMap): PaintOp | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const p = points(o.points, 3);
  if (!p) return null;
  const tool = o.tool === "pencil" || o.tool === "eraser" ? o.tool : "brush";
  const clip = o.clip ? normalizeMask(o.clip, remap) : null;
  return {
    tool,
    points: p,
    brush: normalizeBrush(o.brush),
    color: color(o.color, "#ffffff"),
    ...(clip ? { clip } : {}),
  };
}

function normalizeRetouchOp(v: unknown, remap: AssetMap): RetouchOp | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const p = points(o.points, 3);
  if (!p || !RETOUCH_TOOLS.includes(o.tool as RetouchTool)) return null;
  const off =
    Array.isArray(o.offset) && o.offset.length === 2 && o.offset.every(isNum)
      ? (o.offset as [number, number])
      : undefined;
  const clip = o.clip ? normalizeMask(o.clip, remap) : null;
  return {
    tool: o.tool as RetouchTool,
    points: p,
    brush: normalizeBrush(o.brush),
    strength: num(o.strength, 0.5, 0, 1),
    ...(off ? { offset: off } : {}),
    ...(o.range === "shadows" || o.range === "highlights" || o.range === "midtones" ? { range: o.range } : {}),
    ...(isNum(o.threshold) ? { threshold: num(o.threshold, 0.1, 0, 1) } : {}),
    ...(clip ? { clip } : {}),
  };
}

/** Validates one untrusted layer (returns null if unusable). */
export function normalizeLayer(raw: unknown, remap: AssetMap = defaultRemap): LayerDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  const common: LayerBase = {
    id: o.id.slice(0, 64),
    name: typeof o.name === "string" ? o.name.slice(0, 120) : "Layer",
    kind: "image",
    visible: o.visible !== false,
    locked: o.locked === true,
    opacity: num(o.opacity, 100, 0, 100),
    blendMode: (BLEND_MODES as readonly string[]).includes(o.blendMode as string)
      ? (o.blendMode as BlendMode)
      : "normal",
    mask: o.mask ? normalizeMask(o.mask, remap) : null,
    maskEnabled: o.maskEnabled !== false,
    maskFeather: num(o.maskFeather, 0, 0, 5000),
    parentId: typeof o.parentId === "string" ? o.parentId : null,
  };
  switch (o.kind) {
    case "base":
      return { ...common, kind: "base", id: BASE_LAYER_ID, parentId: null };
    case "image": {
      const assetId = remap(o.assetId);
      return assetId ? { ...common, kind: "image", assetId, placement: normalizePlacement(o.placement) } : null;
    }
    case "text":
      return {
        ...common,
        kind: "text",
        text: typeof o.text === "string" ? o.text.slice(0, 10_000) : "",
        fontFamily: typeof o.fontFamily === "string" ? o.fontFamily.slice(0, 120) : "sans-serif",
        fontSize: num(o.fontSize, 64, 1, 20000),
        fontWeight: num(o.fontWeight, 400, 100, 900),
        color: color(o.color, "#ffffff"),
        align: o.align === "left" || o.align === "right" ? o.align : "center",
        placement: normalizePlacement(o.placement),
      };
    case "shape":
      return {
        ...common,
        kind: "shape",
        shape: o.shape === "ellipse" ? "ellipse" : "rectangle",
        fill: o.fill === null ? null : color(o.fill, "#ffffff"),
        stroke: o.stroke ? color(o.stroke, "#000000") : null,
        strokeWidth: num(o.strokeWidth, 0, 0, 5000),
        placement: normalizePlacement(o.placement),
      };
    case "adjustment": {
      const a = (o.adjustment ?? {}) as Record<string, unknown>;
      return {
        ...common,
        kind: "adjustment",
        adjustment: {
          exposure: num(a.exposure, 0, -5, 5),
          contrast: num(a.contrast, 0, -100, 100),
          highlights: num(a.highlights, 0, -100, 100),
          shadows: num(a.shadows, 0, -100, 100),
          saturation: num(a.saturation, 0, -100, 100),
          temperature: num(a.temperature, 0, -100, 100),
          tint: num(a.tint, 0, -100, 100),
          hue: num(a.hue, 0, -180, 180),
        },
      };
    }
    case "group":
      return { ...common, kind: "group", collapsed: o.collapsed === true };
    case "paint":
      return {
        ...common,
        kind: "paint",
        ops: (Array.isArray(o.ops) ? o.ops.slice(0, MAX_OPS) : [])
          .map((p) => normalizePaintOp(p, remap))
          .filter((p): p is PaintOp => !!p),
      };
    case "retouch":
      return {
        ...common,
        kind: "retouch",
        ops: (Array.isArray(o.ops) ? o.ops.slice(0, MAX_OPS) : [])
          .map((p) => normalizeRetouchOp(p, remap))
          .filter((p): p is RetouchOp => !!p),
      };
    default:
      return null;
  }
}

const defaultRemap: AssetMap = (id) => (typeof id === "string" ? id : null);

/**
 * Structural fix-up of an already-validated stack: exactly one base layer at
 * index 0, unique ids, parents that exist, are groups and form no cycles.
 * Layers that need no change are returned as the same objects (sharing kept).
 */
export function fixLayerStack(input: (LayerDoc | null | undefined)[]): LayerDoc[] {
  const out: LayerDoc[] = [];
  const seen = new Set<string>();
  let base: LayerDoc | null = null;
  for (const l of input.slice(0, 1000)) {
    if (!l) continue;
    if (l.kind === "base") {
      if (!base) base = l;
      continue;
    }
    if (seen.has(l.id) || l.id === BASE_LAYER_ID) continue;
    seen.add(l.id);
    out.push(l);
  }
  const groups = new Set(out.filter((l) => l.kind === "group").map((l) => l.id));
  const parentOf = new Map(out.map((l) => [l.id, l.parentId]));
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    let ok = !l.parentId || (groups.has(l.parentId) && l.parentId !== l.id);
    if (ok && l.parentId) {
      const visited = new Set<string>([l.id]);
      let cur: string | null = l.parentId;
      while (cur) {
        if (visited.has(cur)) {
          ok = false;
          break;
        }
        visited.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
    }
    if (!ok) {
      out[i] = { ...l, parentId: null };
      parentOf.set(l.id, null);
    }
  }
  return [base ?? baseLayer(), ...out];
}

/** Validates an untrusted layer list (storage / imported .prostudio files). */
export function normalizeLayers(input: unknown, remap: AssetMap = defaultRemap): LayerDoc[] {
  return fixLayerStack((Array.isArray(input) ? input.slice(0, 1000) : []).map((l) => normalizeLayer(l, remap)));
}

/** Every asset referenced by a layer stack (images, raster masks/clips). */
export function collectAssetIds(layers: LayerDoc[]): Set<string> {
  const ids = new Set<string>();
  const visitMask = (m: MaskDoc | null | undefined) => {
    if (!m) return;
    for (const op of m.ops) {
      if (op.type === "raster") ids.add(op.assetId);
      if (op.type === "mask") visitMask(op.mask);
    }
  };
  for (const l of layers) {
    visitMask(l.mask);
    if (l.kind === "image") ids.add(l.assetId);
    if (l.kind === "paint") l.ops.forEach((o) => visitMask(o.clip));
    if (l.kind === "retouch") l.ops.forEach((o) => visitMask(o.clip));
  }
  return ids;
}

/** Children of `parentId` in stack order (bottom → top). */
export function childrenOf(layers: LayerDoc[], parentId: string | null): LayerDoc[] {
  return layers.filter((l) => l.parentId === parentId);
}

/** True if any visible layer needs whole-image context (retouch ops sample far from their stroke). */
export function needsSinglePass(layers: LayerDoc[]): boolean {
  return layers.some((l) => l.kind === "retouch" && l.visible && l.ops.length > 0);
}
