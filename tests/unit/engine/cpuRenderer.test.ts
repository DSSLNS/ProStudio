import { beforeAll, describe, expect, it } from "vitest";
import { defaultRecipe } from "@/types/edit";
import { outputSize, outputToSourceMatrix } from "@/engine/image/transform";
import { blurRadiiFor } from "@/engine/gl/WebGLRenderer";

beforeAll(() => {
  // Minimal ImageData polyfill for the node test environment.
  if (typeof globalThis.ImageData === "undefined") {
    class ImageDataPoly {
      data: Uint8ClampedArray;
      constructor(
        public width: number,
        public height: number,
      ) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    }
    (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPoly;
  }
});

function makeSource(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 37) % 256;
      data[i + 1] = (y * 53) % 256;
      data[i + 2] = ((x + y) * 11) % 256;
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}

describe("CPU renderer", async () => {
  const { renderCpu } = await import("@/engine/cpu/CpuRenderer");

  it("default recipe reproduces the source exactly", () => {
    const src = makeSource(32, 24);
    const r = defaultRecipe();
    const out = renderCpu(src, {
      recipe: r,
      width: 32,
      height: 24,
      outToSrc: outputToSourceMatrix(32, 24, r.geometry, 32, 24),
      radii: blurRadiiFor(r, 32, 24, 1),
      lut: null,
    });
    let maxDiff = 0;
    for (let i = 0; i < src.data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out.data[i] - src.data[i]));
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  it("90° rotation produces swapped dimensions with rotated content", () => {
    const src = makeSource(8, 4);
    const r = defaultRecipe();
    r.geometry.rotation = 90;
    const { width, height } = outputSize(8, 4, r.geometry);
    const out = renderCpu(src, {
      recipe: r,
      width,
      height,
      outToSrc: outputToSourceMatrix(8, 4, r.geometry, width, height),
      radii: blurRadiiFor(r, 8, 4, 1),
      lut: null,
    });
    expect([out.width, out.height]).toEqual([4, 8]);
    // Output (0,0) ← source (0, 3) (bottom-left).
    expect(out.data[0]).toBe(src.data[(3 * 8 + 0) * 4]);
    expect(out.data[1]).toBe(src.data[(3 * 8 + 0) * 4 + 1]);
  });

  it("local adjustments (clarity/sharpen/NR) run and stay finite", () => {
    const src = makeSource(40, 30);
    const r = defaultRecipe();
    Object.assign(r.light, { clarity: 50, texture: 30, dehaze: 20, shadows: 40, highlights: -40 });
    Object.assign(r.detail, { sharpenAmount: 60, noiseLuminance: 30, noiseColor: 40 });
    const out = renderCpu(src, {
      recipe: r,
      width: 40,
      height: 30,
      outToSrc: outputToSourceMatrix(40, 30, r.geometry, 40, 30),
      radii: blurRadiiFor(r, 40, 30, 1),
      lut: null,
    });
    expect(out.data.every((v) => Number.isFinite(v))).toBe(true);
  });
});
