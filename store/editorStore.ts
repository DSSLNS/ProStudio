"use client";

import { create } from "zustand";
import { defaultRecipe, type EditRecipe } from "@/types/edit";
import { BASE_LAYER_ID, normalizeLayers, type LayerDoc } from "@/types/layers";
import type { MaskDoc } from "@/types/layers";
import type { ProjectRecord } from "@/storage/indexedDB";
import type { SniffedFormat } from "@/lib/fileUtils";
import { useHistoryStore } from "./historyStore";

export type EditorTool =
  | "move"
  | "hand"
  | "zoom"
  | "crop"
  | "text"
  | "shape"
  | "brush"
  | "pencil"
  | "eraser"
  | "bg-eraser"
  | "gradient"
  | "select-rect"
  | "select-ellipse"
  | "lasso"
  | "polygon"
  | "wand"
  | "select-brush"
  | "clone"
  | "heal"
  | "spot-heal"
  | "redeye"
  | "dodge"
  | "burn"
  | "smudge"
  | "blur-brush"
  | "sharpen-brush"
  | "dust";

export const RETOUCH_TOOL_IDS: EditorTool[] = ["clone", "heal", "spot-heal", "redeye", "dodge", "burn", "smudge", "blur-brush", "sharpen-brush", "dust"];

export const SELECTION_TOOLS: EditorTool[] = ["select-rect", "select-ellipse", "lasso", "polygon", "wand"];

/** Tools that paint strokes onto layers or masks. */
export const PAINT_TOOLS: EditorTool[] = ["brush", "pencil", "eraser"];
export type CompareMode = "off" | "split" | "side-by-side";
export type EditorPanel =
  "light" | "color" | "curves" | "detail" | "effects" | "geometry" | "layers" | "ai" | "history" | "info";

export interface PreviewSource {
  bitmap: ImageBitmap;
  /** Preview pixels per original pixel (1 = full resolution preview). */
  scale: number;
}

interface EditorState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  project: ProjectRecord | null;
  source: Blob | null;
  sourceFormat: SniffedFormat | null;
  preview: PreviewSource | null;
  recipe: EditRecipe;
  layers: LayerDoc[];
  /** Layer that tools and the properties panel act on. */
  activeLayerId: string;
  /** When true, painting tools edit the active layer's mask instead of its content. */
  editingMask: boolean;
  /** Show the active layer's mask as a greyscale overlay. */
  showMask: boolean;
  /** Current selection (frame-space mask ops), or null for none. */
  selection: MaskDoc | null;
  dirty: boolean;
  lastSavedAt: number | null;

  tool: EditorTool;
  panel: EditorPanel;
  compare: CompareMode;
  splitX: number;
  showOriginal: boolean;
  /** Display pixels per full-resolution output pixel; null = fit to screen. */
  zoom: number | null;
  pan: { x: number; y: number };
  fitZoom: number;

  setLoading: () => void;
  setError: (message: string) => void;
  open: (args: { project: ProjectRecord; source: Blob; sourceFormat: SniffedFormat; preview: PreviewSource }) => void;
  close: () => void;
  /** Live update (no history entry) — use while dragging a slider. */
  updateRecipe: (fn: (draft: EditRecipe) => void) => void;
  /** Create a history entry for the current state. */
  commit: (label: string) => void;
  /** Update and commit in one step. */
  applyRecipe: (label: string, fn: (draft: EditRecipe) => void) => void;
  setLayers: (layers: LayerDoc[], label: string) => void;
  /** Live layer update without a history entry (call commit() when done). */
  updateLayers: (fn: (layers: LayerDoc[]) => LayerDoc[]) => void;
  setActiveLayer: (id: string) => void;
  setEditingMask: (v: boolean) => void;
  setShowMask: (v: boolean) => void;
  setSelection: (s: MaskDoc | null) => void;
  undo: () => void;
  redo: () => void;
  jumpToHistory: (i: number) => void;
  markSaved: () => void;
  setTool: (t: EditorTool) => void;
  setPanel: (p: EditorPanel) => void;
  setCompare: (c: CompareMode) => void;
  setSplitX: (x: number) => void;
  setShowOriginal: (v: boolean) => void;
  setZoom: (z: number | null) => void;
  setPan: (p: { x: number; y: number }) => void;
  setFitZoom: (z: number) => void;
}

function keepActive(active: string, layers: LayerDoc[]) {
  return layers.some((l) => l.id === active) ? {} : { activeLayerId: BASE_LAYER_ID, editingMask: false };
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  status: "idle",
  error: null,
  project: null,
  source: null,
  sourceFormat: null,
  preview: null,
  recipe: defaultRecipe(),
  layers: normalizeLayers([]),
  activeLayerId: BASE_LAYER_ID,
  editingMask: false,
  showMask: false,
  selection: null,
  dirty: false,
  lastSavedAt: null,
  tool: "move",
  panel: "light",
  compare: "off",
  splitX: 0.5,
  showOriginal: false,
  zoom: null,
  pan: { x: 0, y: 0 },
  fitZoom: 1,

  setLoading: () => set({ status: "loading", error: null }),
  setError: (message) => set({ status: "error", error: message }),
  open: ({ project, source, sourceFormat, preview }) => {
    get().preview?.bitmap.close();
    set({
      status: "ready",
      error: null,
      project,
      source,
      sourceFormat,
      preview,
      recipe: project.recipe,
      layers: normalizeLayers(project.layers),
      activeLayerId: BASE_LAYER_ID,
      editingMask: false,
      showMask: false,
      selection: null,
      dirty: false,
      lastSavedAt: project.modifiedAt,
      zoom: null,
      pan: { x: 0, y: 0 },
      compare: "off",
      tool: "move",
    });
  },
  close: () => {
    get().preview?.bitmap.close();
    set({
      status: "idle",
      project: null,
      source: null,
      preview: null,
      recipe: defaultRecipe(),
      layers: normalizeLayers([]),
      selection: null,
      activeLayerId: BASE_LAYER_ID,
    });
  },
  updateRecipe: (fn) => {
    // Two-level shallow clone: fast for slider ticks (mutate leaf → groups → recipe).
    // structuredClone would deep-clone curves arrays on every pointermove at 120 Hz.
    const src = get().recipe;
    const next = { ...src } as EditRecipe;
    for (const k of Object.keys(src) as (keyof EditRecipe)[]) {
      const v = src[k] as unknown;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        (next as unknown as Record<string, unknown>)[k] = { ...(v as object) };
      }
    }
    fn(next);
    set({ recipe: next });
  },
  commit: (label) => {
    const { recipe, layers } = get();
    if (useHistoryStore.getState().push(label, { recipe, layers })) set({ dirty: true });
  },
  applyRecipe: (label, fn) => {
    get().updateRecipe(fn);
    get().commit(label);
  },
  setLayers: (layers, label) => {
    set({ layers });
    get().commit(label);
  },
  updateLayers: (fn) => set({ layers: fn(get().layers) }),
  setActiveLayer: (activeLayerId) => {
    const l = get().layers.find((x) => x.id === activeLayerId);
    set({ activeLayerId, editingMask: get().editingMask && !!l?.mask });
  },
  setEditingMask: (editingMask) => set({ editingMask }),
  setShowMask: (showMask) => set({ showMask }),
  setSelection: (selection) => set({ selection }),
  undo: () => {
    const e = useHistoryStore.getState().undo();
    if (e)
      set({
        recipe: structuredClone(e.recipe),
        layers: e.layers,
        dirty: true,
        ...keepActive(get().activeLayerId, e.layers),
      });
  },
  redo: () => {
    const e = useHistoryStore.getState().redo();
    if (e)
      set({
        recipe: structuredClone(e.recipe),
        layers: e.layers,
        dirty: true,
        ...keepActive(get().activeLayerId, e.layers),
      });
  },
  jumpToHistory: (i) => {
    const e = useHistoryStore.getState().jump(i);
    if (e)
      set({
        recipe: structuredClone(e.recipe),
        layers: e.layers,
        dirty: true,
        ...keepActive(get().activeLayerId, e.layers),
      });
  },
  markSaved: () => set({ dirty: false, lastSavedAt: Date.now() }),
  setTool: (tool) => set({ tool }),
  setPanel: (panel) => set({ panel }),
  setCompare: (compare) => set({ compare }),
  setSplitX: (splitX) => set({ splitX: Math.max(0, Math.min(1, splitX)) }),
  setShowOriginal: (showOriginal) => set({ showOriginal }),
  setZoom: (zoom) =>
    set(zoom === null ? { zoom: null, pan: { x: 0, y: 0 } } : { zoom: Math.max(0.02, Math.min(32, zoom)) }),
  setPan: (pan) => set({ pan }),
  setFitZoom: (fitZoom) => set({ fitZoom }),
}));
