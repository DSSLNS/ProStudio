"use client";

import { useEffect, useRef, useState } from "react";
import { WebGLRenderer, blurRadiiFor, type LutData } from "@/engine/gl/WebGLRenderer";
import { renderCpu, type CpuSource } from "@/engine/cpu/CpuRenderer";
import { effectiveCrop, orientedSize, outputSize, outputToSourceMatrix } from "@/engine/image/transform";
import { GLCompositor } from "@/engine/gl/Compositor";
import { compositeCpu } from "@/engine/layers/cpuCompositor";
import { collectAssetIds, isTrivialStack } from "@/types/layers";
import { viewKey, type View } from "@/engine/layers/view";
import { useEditorStore } from "@/store/editorStore";
import { useUiStore } from "@/store/uiStore";
import { getDB } from "@/storage/indexedDB";
import { editorRuntime } from "./editorRuntime";
import { useViewState } from "./viewState";

export type Backend = "webgl2" | "cpu";

async function loadLut(id: string): Promise<LutData | null> {
  const rec = await (await getDB()).get("luts", id);
  return rec
    ? { id: rec.id, size: rec.size, data: rec.data, domainMin: rec.domainMin, domainMax: rec.domainMax }
    : null;
}

/**
 * Owns the preview renderer (WebGL2, or CPU fallback) and re-renders on every
 * recipe/view change, coalesced to one render per animation frame.
 */
export function usePreviewRenderer(
  glCanvas: HTMLCanvasElement | null,
  cpuCanvas: HTMLCanvasElement | null,
  beforeCanvas: HTMLCanvasElement | null,
) {
  const gpuPref = useUiStore((s) => s.gpuAcceleration);
  const preview = useEditorStore((s) => s.preview);
  const recipe = useEditorStore((s) => s.recipe);
  const project = useEditorStore((s) => s.project);
  const compare = useEditorStore((s) => s.compare);
  const splitX = useEditorStore((s) => s.splitX);
  const showOriginal = useEditorStore((s) => s.showOriginal);
  const tool = useEditorStore((s) => s.tool);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const showMask = useEditorStore((s) => s.showMask);
  const [assetsVersion, setAssetsVersion] = useState(0);
  const compositor = useRef<GLCompositor | null>(null);
  const [backend, setBackend] = useState<Backend | null>(null);
  /** Increments whenever the renderer is (re)created, so uploads/renders re-run. */
  const [generation, setGeneration] = useState(0);
  const gpu = useRef<WebGLRenderer | null>(null);
  const cpuSrc = useRef<CpuSource | null>(null);
  const lut = useRef<LutData | null>(null);
  const [lutVersion, setLutVersion] = useState(0);
  const frame = useRef<number | null>(null);

  // Create the renderer.
  useEffect(() => {
    if (!glCanvas || !cpuCanvas) return;
    if (gpuPref) gpu.current = WebGLRenderer.create(glCanvas);
    if (gpu.current && lut.current) gpu.current.setLut(lut.current);
    compositor.current = gpu.current ? new GLCompositor(gpu.current) : null;
    const b: Backend = gpu.current ? "webgl2" : "cpu";
    setBackend(b);
    setGeneration((g) => g + 1);
    editorRuntime.canvas = b === "webgl2" ? glCanvas : cpuCanvas;
    editorRuntime.requestRender = () => setAssetsVersion((v) => v + 1);
    return () => {
      compositor.current?.dispose();
      compositor.current = null;
      gpu.current?.dispose();
      gpu.current = null;
      editorRuntime.canvas = null;
    };
  }, [glCanvas, cpuCanvas, gpuPref]);

  // Upload the preview source.
  useEffect(() => {
    if (!preview || !backend) return;
    compositor.current?.clearCaches();
    if (backend === "webgl2" && gpu.current) {
      gpu.current.setSource(preview.bitmap, preview.bitmap.width, preview.bitmap.height);
    } else {
      const c = document.createElement("canvas");
      c.width = preview.bitmap.width;
      c.height = preview.bitmap.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(preview.bitmap, 0, 0);
      cpuSrc.current = { data: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
    }
  }, [preview, backend, generation]);

  // Load LUT data when the recipe references a different LUT.
  const lutId = recipe.lut?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!lutId) {
      lut.current = null;
      gpu.current?.setLut(null);
      return;
    }
    if (lut.current?.id === lutId) return;
    void loadLut(lutId).then((l) => {
      if (cancelled) return;
      lut.current = l;
      gpu.current?.setLut(l);
      setLutVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [lutId, backend]);

  // Render (coalesced per frame).
  useEffect(() => {
    if (!preview || !project || !backend) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const t0 = performance.now();
      // While cropping, show the whole (warped) frame so the crop can be adjusted.
      const geometry = tool === "crop" ? { ...recipe.geometry, crop: null } : recipe.geometry;
      const r = { ...recipe, geometry };
      const full = outputSize(project.width, project.height, geometry);
      const width = Math.max(1, Math.round(full.width * preview.scale));
      const height = Math.max(1, Math.round(full.height * preview.scale));
      const outToSrc = outputToSourceMatrix(preview.bitmap.width, preview.bitmap.height, geometry, width, height);
      const radii = blurRadiiFor(r, project.width, project.height, preview.scale);
      const common = { recipe: r, width, height, outToSrc, radii, grainScale: 1 / preview.scale };
      // Frame-space window shown by this render (layers, masks and tools work in frame px).
      const frameSize = orientedSize(project.width, project.height, geometry);
      const crop = effectiveCrop(geometry);
      const view: View = {
        originX: crop.x * frameSize.width,
        originY: crop.y * frameSize.height,
        scale: width / Math.max(1, full.width),
        width,
        height,
      };
      editorRuntime.view = view;
      const active = layers.find((l) => l.id === activeLayerId);
      const maskPreview = showMask && !!active?.mask;
      const layered = !isTrivialStack(layers) || maskPreview;
      if (layered) {
        const ids = collectAssetIds(layers);
        if (!editorRuntime.assets.has(ids)) {
          void editorRuntime.assets.ensure(ids).then(() => setAssetsVersion((v) => v + 1));
        }
      }
      const assets = editorRuntime.assets;
      if (backend === "webgl2" && gpu.current && layered && compositor.current) {
        const c = compositor.current;
        const develop = { recipe: r, outToSrc, radii, grainScale: 1 / preview.scale };
        const wantBefore = showOriginal || (compare !== "off" && tool !== "crop");
        const before = wantBefore ? c.composite({ develop, layers, view, assets, before: true }) : null;
        if (showOriginal && before) {
          c.present(before);
        } else {
          const after = c.composite({ develop, layers, view, assets });
          if (compare === "side-by-side" && beforeCanvas && before) {
            c.present(before);
            beforeCanvas.width = width;
            beforeCanvas.height = height;
            beforeCanvas.getContext("2d")!.drawImage(gpu.current.canvas as HTMLCanvasElement, 0, 0);
          }
          const maskTex =
            maskPreview && active
              ? c.maskTexture(active.id, active.mask, true, active.maskFeather, view, viewKey(view), assets)
              : null;
          c.present(after, {
            before: compare === "split" && tool !== "crop" ? before : null,
            splitX: compare === "split" && tool !== "crop" ? splitX : null,
            maskTex,
            maskView: 2,
          });
          c.release(after);
        }
        if (before) c.release(before);
      } else if (backend === "webgl2" && gpu.current) {
        if (compare === "side-by-side" && beforeCanvas) {
          gpu.current.render({ ...common, before: true });
          beforeCanvas.width = width;
          beforeCanvas.height = height;
          beforeCanvas.getContext("2d")!.drawImage(gpu.current.canvas as HTMLCanvasElement, 0, 0);
        }
        gpu.current.render({
          ...common,
          before: showOriginal,
          splitX: compare === "split" && tool !== "crop" ? splitX : null,
        });
      } else if (cpuSrc.current && cpuCanvas) {
        const img = renderCpu(cpuSrc.current, { ...common, lut: lut.current, before: showOriginal });
        cpuCanvas.width = width;
        cpuCanvas.height = height;
        if (layered && !showOriginal) {
          const res = compositeCpu(img, layers, view, assets);
          const ctx = cpuCanvas.getContext("2d")!;
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(res.canvas, 0, 0);
          useViewState.getState().set({ unsupported: res.unsupported });
        } else {
          cpuCanvas.getContext("2d")!.putImageData(img, 0, 0);
        }
        if (compare === "side-by-side" && beforeCanvas) {
          const b = renderCpu(cpuSrc.current, { ...common, lut: null, before: true });
          beforeCanvas.width = width;
          beforeCanvas.height = height;
          beforeCanvas.getContext("2d")!.putImageData(b, 0, 0);
        }
      }
      useViewState.getState().set({
        renderInfo: { width, height, backend, ms: performance.now() - t0 },
        histogramVersion: useViewState.getState().histogramVersion + 1,
      });
    });
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [
    preview,
    project,
    backend,
    generation,
    recipe,
    compare,
    splitX,
    showOriginal,
    tool,
    beforeCanvas,
    cpuCanvas,
    lutVersion,
    layers,
    activeLayerId,
    showMask,
    assetsVersion,
  ]);

  return backend;
}
