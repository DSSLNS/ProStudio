/**
 * WebGL2 implementation of the develop pipeline. Works with HTMLCanvasElement
 * (interactive preview) and OffscreenCanvas (export worker).
 *
 * Passes:
 *   1. features  — source → (luma, min-channel, Cb, Cr) at source resolution
 *   2. blur ×3   — large / medium / small Gaussian of the feature map (pyramid-downsampled for large radii)
 *   3. develop   — one inverse-mapped pass: geometry + all colour/tone/detail maths
 * Features are cached until the source or the blur radii change, so slider drags
 * only re-run pass 3.
 */
import { BLUR_FS, DEVELOP_FS, DOWNSAMPLE_FS, FEATURES_FS, FULLSCREEN_VS } from "./shaders";
import { buildDevelopParams, needsLocalFeatures, type DevelopParams } from "@/engine/color/pipeline";
import { buildCurveTable, CURVE_LUT_SIZE } from "@/engine/color/curves";
import type { Mat3 } from "@/engine/image/transform";
import type { EditRecipe } from "@/types/edit";

type GL = WebGL2RenderingContext;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface LutData {
  id: string;
  size: number;
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export interface BlurRadii {
  /** Gaussian sigmas, in pixels of the CURRENT source texture. */
  large: number;
  medium: number;
  small: number;
}

/** Blur radii derived from the recipe, scaled to the current source resolution. */
export function blurRadiiFor(recipe: EditRecipe, fullW: number, fullH: number, sourceScale: number): BlurRadii {
  const short = Math.min(fullW, fullH);
  return {
    large: Math.max(1, short * 0.02 * sourceScale),
    medium: Math.max(0.8, short * 0.004 * sourceScale),
    small: Math.max(0.5, recipe.detail.sharpenRadius * sourceScale),
  };
}

export interface RenderOptions {
  recipe: EditRecipe;
  /** Render target size (the canvas is resized to this). */
  width: number;
  height: number;
  /** Output pixel → source-texture pixel. */
  outToSrc: Mat3;
  radii: BlurRadii;
  /** Offset of this render within a larger (tiled) output, and that output's size. */
  tileOffset?: [number, number];
  fullSize?: [number, number];
  /** Full-resolution pixels per render pixel (grain scale). */
  grainScale?: number;
  premultiply?: boolean;
  /** Before/after split position (0..1), or null to disable. */
  splitX?: number | null;
  /** Render the unedited original (geometry still applied). */
  before?: boolean;
  /** Render into this offscreen target instead of the canvas (used by the layer compositor). */
  target?: Target;
}

export class WebGLRenderer {
  readonly canvas: AnyCanvas;
  readonly gl: GL;
  readonly floatTargets: boolean;
  private progFeatures!: WebGLProgram;
  private progDown!: WebGLProgram;
  private progBlur!: WebGLProgram;
  private progDevelop!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private srcTex: WebGLTexture | null = null;
  private srcW = 0;
  private srcH = 0;
  private curvesTex!: WebGLTexture;
  private curvesKey = "";
  private lutTex!: WebGLTexture;
  private lut: LutData | null = null;
  private features: { l: Target; m: Target; s: Target } | null = null;
  private featuresKey = "";
  private scratch: Target[] = [];
  private uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  readonly maxTextureSize: number;
  lost = false;

  static create(canvas: AnyCanvas): WebGLRenderer | null {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    }) as GL | null;
    if (!gl) return null;
    try {
      return new WebGLRenderer(canvas, gl);
    } catch (e) {
      console.warn("[ProStudio] WebGL2 renderer init failed", e);
      return null;
    }
  }

  private constructor(canvas: AnyCanvas, gl: GL) {
    this.canvas = canvas;
    this.gl = gl;
    this.floatTargets = !!gl.getExtension("EXT_color_buffer_float");
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.init();
    canvas.addEventListener("webglcontextlost", ((e: Event) => {
      e.preventDefault();
      this.lost = true;
    }) as EventListener);
    canvas.addEventListener("webglcontextrestored", (() => {
      this.lost = false;
      this.srcTex = null;
      this.features = null;
      this.featuresKey = "";
      this.curvesKey = "";
      this.scratch = [];
      this.uniformCache.clear();
      this.init();
    }) as EventListener);
  }

  private init() {
    const gl = this.gl;
    this.progFeatures = this.program(FEATURES_FS);
    this.progDown = this.program(DOWNSAMPLE_FS);
    this.progBlur = this.program(BLUR_FS);
    this.progDevelop = this.program(DEVELOP_FS);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [this.progFeatures, this.progDown, this.progBlur, this.progDevelop]) {
      const loc = gl.getAttribLocation(p, "aPos");
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    this.curvesTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.curvesTex);
    this.texParams(gl.TEXTURE_2D, gl.LINEAR);
    this.lutTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, 2, 2, 2, 0, gl.RGB, gl.FLOAT, new Float32Array(24));
    if (this.lut) this.uploadLut(this.lut);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`Shader compile failed: ${log}`);
    }
    return s;
  }

  program(fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, FULLSCREEN_VS));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program link failed: ${gl.getProgramInfoLog(p)}`);
    return p;
  }

  u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.uniformCache.get(p);
    if (!m) this.uniformCache.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }

  private texParams(target: number, filter: number) {
    const gl = this.gl;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  createTarget(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.texParams(gl.TEXTURE_2D, gl.LINEAR);
    if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  releaseTarget(t: Target) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  /** Upload a new source image (sRGB-encoded, straight alpha). */
  setSource(img: TexImageSource, width: number, height: number) {
    const gl = this.gl;
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new Error(`Image region ${width}×${height} exceeds the GPU texture limit (${this.maxTextureSize}px).`);
    }
    if (!this.srcTex) this.srcTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.texParams(gl.TEXTURE_2D, gl.LINEAR_MIPMAP_LINEAR);
    this.srcW = width;
    this.srcH = height;
    this.dropFeatures();
  }

  private dropFeatures() {
    if (this.features) {
      this.releaseTarget(this.features.l);
      this.releaseTarget(this.features.m);
      this.releaseTarget(this.features.s);
    }
    for (const t of this.scratch) this.releaseTarget(t);
    this.scratch = [];
    this.features = null;
    this.featuresKey = "";
  }

  setLut(lut: LutData | null) {
    this.lut = lut;
    if (lut) this.uploadLut(lut);
  }

  private uploadLut(lut: LutData) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  private updateCurves(recipe: EditRecipe) {
    const key = JSON.stringify(recipe.curves);
    if (key === this.curvesKey) return;
    this.curvesKey = key;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.curvesTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      CURVE_LUT_SIZE,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      buildCurveTable(recipe.curves),
    );
  }

  draw(target: Target | null, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  bindTex(unit: number, tex: WebGLTexture, target: number = this.gl.TEXTURE_2D) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(target, tex);
  }

  /** Blur `input` (w×h) with sigma, returning a (possibly smaller) target. */
  blur(input: Target, sigma: number): Target {
    const gl = this.gl;
    let cur = input;
    let s = sigma;
    const temp: Target[] = [];
    // Halve resolution until the kernel radius is manageable.
    while (s > 6 && cur.w > 8 && cur.h > 8) {
      const w = Math.max(1, Math.ceil(cur.w / 2));
      const h = Math.max(1, Math.ceil(cur.h / 2));
      const t = this.createTarget(w, h);
      gl.useProgram(this.progDown);
      this.bindTex(0, cur.tex);
      gl.uniform1i(this.u(this.progDown, "uTex"), 0);
      gl.uniform2f(this.u(this.progDown, "uSrcSize"), cur.w, cur.h);
      this.draw(t, w, h);
      if (cur !== input) temp.push(cur);
      cur = t;
      s /= 2;
    }
    const radius = Math.min(64, Math.max(1, Math.ceil(s * 3)));
    const a = this.createTarget(cur.w, cur.h);
    const b = this.createTarget(cur.w, cur.h);
    gl.useProgram(this.progBlur);
    gl.uniform1i(this.u(this.progBlur, "uTex"), 0);
    gl.uniform2f(this.u(this.progBlur, "uSize"), cur.w, cur.h);
    gl.uniform1f(this.u(this.progBlur, "uSigma"), Math.max(0.3, s));
    gl.uniform1i(this.u(this.progBlur, "uRadius"), radius);
    this.bindTex(0, cur.tex);
    gl.uniform2f(this.u(this.progBlur, "uDir"), 1, 0);
    this.draw(a, cur.w, cur.h);
    this.bindTex(0, a.tex);
    gl.uniform2f(this.u(this.progBlur, "uDir"), 0, 1);
    this.draw(b, cur.w, cur.h);
    if (cur !== input) temp.push(cur);
    temp.push(a);
    for (const t of temp) this.releaseTarget(t);
    return b;
  }

  private ensureFeatures(radii: BlurRadii) {
    const key = `${this.srcW}x${this.srcH}:${radii.large.toFixed(2)}:${radii.medium.toFixed(2)}:${radii.small.toFixed(2)}`;
    if (this.features && this.featuresKey === key) return;
    this.dropFeatures();
    const gl = this.gl;
    const base = this.createTarget(this.srcW, this.srcH);
    gl.useProgram(this.progFeatures);
    this.bindTex(0, this.srcTex!);
    gl.uniform1i(this.u(this.progFeatures, "uSrc"), 0);
    gl.uniform2f(this.u(this.progFeatures, "uSize"), this.srcW, this.srcH);
    this.draw(base, this.srcW, this.srcH);
    this.features = {
      l: this.blur(base, radii.large),
      m: this.blur(base, radii.medium),
      s: this.blur(base, radii.small),
    };
    this.releaseTarget(base);
    this.featuresKey = key;
  }

  render(o: RenderOptions) {
    if (this.lost || !this.srcTex) return;
    const gl = this.gl;
    if (!o.target) {
      if (this.canvas.width !== o.width) this.canvas.width = o.width;
      if (this.canvas.height !== o.height) this.canvas.height = o.height;
    }
    const params = buildDevelopParams(o.recipe, !!this.lut && this.lut.id === o.recipe.lut?.id);
    const useFeatures = !o.before && needsLocalFeatures(params);
    if (useFeatures) this.ensureFeatures(o.radii);
    this.updateCurves(o.recipe);

    const p = this.progDevelop;
    gl.useProgram(p);
    this.bindTex(0, this.srcTex);
    gl.uniform1i(this.u(p, "uSrc"), 0);
    if (useFeatures && this.features) {
      this.bindTex(1, this.features.l.tex);
      this.bindTex(2, this.features.m.tex);
      this.bindTex(3, this.features.s.tex);
    } else {
      // Bind something valid; values are ignored when uUseFeatures is false.
      this.bindTex(1, this.srcTex);
      this.bindTex(2, this.srcTex);
      this.bindTex(3, this.srcTex);
    }
    gl.uniform1i(this.u(p, "uFeatL"), 1);
    gl.uniform1i(this.u(p, "uFeatM"), 2);
    gl.uniform1i(this.u(p, "uFeatS"), 3);
    this.bindTex(4, this.curvesTex);
    gl.uniform1i(this.u(p, "uCurves"), 4);
    this.bindTex(5, this.lutTex, gl.TEXTURE_3D);
    gl.uniform1i(this.u(p, "uLut"), 5);
    gl.uniform1i(this.u(p, "uUseFeatures"), useFeatures ? 1 : 0);

    // mat3 uniforms are column-major; our Mat3 is row-major → transpose.
    const m = o.outToSrc;
    gl.uniformMatrix3fv(this.u(p, "uOutToSrc"), false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
    gl.uniform2f(this.u(p, "uSrcSize"), this.srcW, this.srcH);
    gl.uniform2f(this.u(p, "uRenderSize"), o.width, o.height);
    gl.uniform2f(this.u(p, "uTileOffset"), o.tileOffset?.[0] ?? 0, o.tileOffset?.[1] ?? 0);
    gl.uniform2f(this.u(p, "uFullSize"), o.fullSize?.[0] ?? o.width, o.fullSize?.[1] ?? o.height);
    gl.uniform1f(this.u(p, "uGrainScale"), o.grainScale ?? 1);
    gl.uniform1i(this.u(p, "uPremultiply"), o.premultiply === false ? 0 : 1);
    gl.uniform1i(this.u(p, "uSplitBefore"), o.before || o.splitX != null ? 1 : 0);
    gl.uniform1f(this.u(p, "uSplitX"), o.before ? 2 : (o.splitX ?? 0));
    this.setDevelopUniforms(p, params);
    this.draw(o.target ?? null, o.width, o.height);
  }

  private setDevelopUniforms(p: WebGLProgram, d: DevelopParams) {
    const gl = this.gl;
    const f = (n: string, v: number) => gl.uniform1f(this.u(p, n), v);
    gl.uniform3fv(this.u(p, "uWb"), d.wb);
    f("uExposureMul", d.exposureMul);
    f("uDehaze", d.dehaze);
    f("uShadows", d.shadows);
    f("uHighlights", d.highlights);
    f("uWhites", d.whites);
    f("uBlacks", d.blacks);
    f("uContrast", d.contrast);
    f("uBrightness", d.brightness);
    f("uGamma", d.gamma);
    f("uClarity", d.clarity);
    f("uTexture", d.texture);
    f("uSharpen", d.sharpen);
    f("uNoiseLum", d.noiseLum);
    f("uNoiseColor", d.noiseColor);
    f("uHueShift", d.hueShift);
    f("uSaturation", d.saturation);
    f("uVibrance", d.vibrance);
    gl.uniform1fv(this.u(p, "uHslHue[0]"), d.hslHue);
    gl.uniform1fv(this.u(p, "uHslSat[0]"), d.hslSat);
    gl.uniform1fv(this.u(p, "uHslLum[0]"), d.hslLum);
    gl.uniform1i(this.u(p, "uHslActive"), [...d.hslHue, ...d.hslSat, ...d.hslLum].some(Boolean) ? 1 : 0);
    const grades = [d.gradeShadows, d.gradeMidtones, d.gradeHighlights, d.gradeGlobal];
    gl.uniform3fv(
      this.u(p, "uGradeTint[0]"),
      grades.flatMap((g) => g.tint),
    );
    gl.uniform1fv(
      this.u(p, "uGradeLum[0]"),
      grades.map((g) => g.lum),
    );
    f("uGradeSplit", d.gradeSplit);
    f("uGradePower", d.gradePower);
    gl.uniform3fv(this.u(p, "uBal[0]"), [...d.balShadows, ...d.balMidtones, ...d.balHighlights]);
    gl.uniform1i(this.u(p, "uCurvesActive"), d.curvesActive ? 1 : 0);
    f("uLutIntensity", d.lutIntensity);
    f("uLutSize", this.lut?.size ?? 2);
    gl.uniform3fv(this.u(p, "uLutDomainMin"), this.lut?.domainMin ?? [0, 0, 0]);
    gl.uniform3fv(this.u(p, "uLutDomainMax"), this.lut?.domainMax ?? [1, 1, 1]);
    f("uVigAmount", d.vignetteAmount);
    f("uVigMid", d.vignetteMid);
    f("uVigFeather", d.vignetteFeather);
    f("uVigRound", d.vignetteRoundness);
    f("uGrain", d.grain);
  }

  /** Read back the last render as top-down, straight-alpha RGBA bytes (render with premultiply:false). */
  readPixels(width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8ClampedArray(width * height * 4);
    const row = width * 4;
    for (let y = 0; y < height; y++) out.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return out;
  }

  /** Read an offscreen target as top-down RGBA bytes (targets are stored bottom-up). */
  readTarget(t: Target): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const raw = new Uint8Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8ClampedArray(t.w * t.h * 4);
    const row = t.w * 4;
    for (let y = 0; y < t.h; y++) out.set(raw.subarray((t.h - 1 - y) * row, (t.h - y) * row), y * row);
    return out;
  }

  /** 8-bit RGBA target (for compositing results that are read back). */
  createTarget8(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.texParams(gl.TEXTURE_2D, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  dispose() {
    this.dropFeatures();
    const gl = this.gl;
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    gl.deleteTexture(this.curvesTex);
    gl.deleteTexture(this.lutTex);
    this.srcTex = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
