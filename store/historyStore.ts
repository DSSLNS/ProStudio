"use client";

import { create } from "zustand";
import type { EditRecipe } from "@/types/edit";
import type { LayerDoc } from "@/types/layers";
import type { HistoryEntry } from "@/storage/indexedDB";

const MAX_ENTRIES = 200;

/**
 * Edit history as a list of lightweight state snapshots (recipe JSON + layer
 * metadata, a few KB each). Pixel data is never duplicated per step — the
 * renderer re-derives pixels from the original + recipe.
 */
interface HistoryState {
  entries: HistoryEntry[];
  index: number;
  reset: (initial: { recipe: EditRecipe; layers: LayerDoc[] }, label?: string) => void;
  load: (entries: HistoryEntry[], index: number) => void;
  push: (label: string, state: { recipe: EditRecipe; layers: LayerDoc[] }) => boolean;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
  jump: (i: number) => HistoryEntry | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

/** Recipes are small and mutable-by-clone; layers are immutable values shared by reference. */
const snap = (s: { recipe: EditRecipe; layers: LayerDoc[] }) => ({
  recipe: structuredClone(s.recipe),
  layers: s.layers,
});

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  entries: [],
  index: -1,
  reset: (initial, label = "Open") => set({ entries: [{ label, ...snap(initial), at: Date.now() }], index: 0 }),
  load: (entries, index) => set({ entries, index: Math.max(0, Math.min(entries.length - 1, index)) }),
  push: (label, state) => {
    const { entries, index } = get();
    const cur = entries[index];
    if (
      cur &&
      JSON.stringify(cur.recipe) === JSON.stringify(state.recipe) &&
      (cur.layers === state.layers || JSON.stringify(cur.layers) === JSON.stringify(state.layers))
    ) {
      return false; // no-op change
    }
    const next = [...entries.slice(0, index + 1), { label, ...snap(state), at: Date.now() }];
    const trimmed = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    set({ entries: trimmed, index: trimmed.length - 1 });
    return true;
  },
  undo: () => {
    const { entries, index } = get();
    if (index <= 0) return null;
    set({ index: index - 1 });
    return entries[index - 1];
  },
  redo: () => {
    const { entries, index } = get();
    if (index >= entries.length - 1) return null;
    set({ index: index + 1 });
    return entries[index + 1];
  },
  jump: (i) => {
    const { entries } = get();
    if (i < 0 || i >= entries.length) return null;
    set({ index: i });
    return entries[i];
  },
  canUndo: () => get().index > 0,
  canRedo: () => get().index < get().entries.length - 1,
}));
