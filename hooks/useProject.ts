"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { getHistory, getProject, getProjectSource, saveProjectState } from "@/storage/projects";
import { useEditorStore } from "@/store/editorStore";
import { useHistoryStore } from "@/store/historyStore";
import { previewLongEdge, useUiStore } from "@/store/uiStore";
import { decodeToBitmap, sniffFormat } from "@/lib/fileUtils";
import { getBrowserCapabilities } from "@/lib/browserCapabilities";
import { editorRuntime } from "@/components/editor/editorRuntime";
import { fixLayerStack } from "@/types/layers";

/** Loads a project into the editor: original blob + optimised preview bitmap + history. */
export function useLoadProject(projectId: string | null) {
  const performanceMode = useUiStore((s) => s.performanceMode);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const store = useEditorStore.getState();
    store.setLoading();
    (async () => {
      try {
        const project = await getProject(projectId);
        if (!project) throw new Error("This project could not be found on this device.");
        const source = await getProjectSource(project);
        const format = await sniffFormat(source, project.sourceName);
        const caps = await getBrowserCapabilities();
        const longEdge = Math.min(previewLongEdge(performanceMode), caps.maxTextureSize || 4096);
        const bitmap = await decodeToBitmap(source, format, { maxLongEdge: longEdge });
        if (cancelled) {
          bitmap.close();
          return;
        }
        const scale = bitmap.width / project.width;
        const history = await getHistory(project.id);
        if (history?.entries.length) {
          // Older entries may predate layers; fix each stack (unchanged layers keep their identity).
          const entries = history.entries.map((e) => ({ ...e, layers: fixLayerStack(e.layers ?? []) }));
          useHistoryStore.getState().load(entries, history.index);
        } else useHistoryStore.getState().reset({ recipe: project.recipe, layers: project.layers });
        useEditorStore.getState().open({ project, source, sourceFormat: format, preview: { bitmap, scale } });
        if (scale < 0.999) {
          toast.info("High-resolution image detected.", {
            description:
              "Using an optimised preview for editing. Your original image will be used for full-resolution export.",
            duration: 6000,
          });
        }
      } catch (e) {
        if (!cancelled) useEditorStore.getState().setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, performanceMode]);
}

/** Saves recipe/layers/history (and a fresh thumbnail) to IndexedDB. */
export function useSaveProject() {
  return useCallback(async (opts: { silent?: boolean } = {}) => {
    const { project, recipe, layers } = useEditorStore.getState();
    if (!project) return;
    const { entries, index } = useHistoryStore.getState();
    try {
      const thumbnail = (await editorRuntime.renderThumbnail()) ?? undefined;
      await saveProjectState(project.id, {
        recipe,
        layers,
        history: { projectId: project.id, entries, index },
        thumbnail,
      });
      useEditorStore.getState().markSaved();
      if (!opts.silent) toast.success("Project saved locally");
    } catch (e) {
      toast.error(`Could not save project: ${(e as Error).message}`);
    }
  }, []);
}

/** Debounced auto-save after edits (Settings → Auto-save). */
export function useAutoSave() {
  const autoSave = useUiStore((s) => s.autoSave);
  const save = useSaveProject();
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!autoSave) return;
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.dirty && (s.recipe !== prev.recipe || s.layers !== prev.layers || !prev.dirty)) {
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void save({ silent: true }), 1500);
      }
    });
    return () => {
      unsub();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [autoSave, save]);
}
