/**
 * GPU layer compositor. Runs in the same WebGL2 context as the develop pass:
 *
 *   base (developed photo) ─► [base mask/opacity] ─► accum
 *   for each layer (bottom→top): content ─► mask ─► blend(accum, content, mode, opacity)
 *     • image/text/shape/paint: rasterised (Canvas2D) in the current view, uploaded
 *     • adjustment: adjust(accum) blended back through the mask
 *     • group: children composited into an isolated buffer, then blended as one
 *     • retouch: operations re-applied to accum (see RetouchRenderer)
 *
 * All intermediate buffers are premultiplied and match the render size.
 */
import type { Target, WebGLRenderer, RenderOptions } from "./WebGLRenderer";
import { BLEND_GLSL, BLEND_MODE_INDEX } from "@/engine/layers/blend";
import { ADJUST_GLSL, adjustUniforms, isIdentityAdjustment } from "@/engine/layers/adjust";
import type { AdjustmentParams, BlendMode, LayerDoc, MaskDoc } from "@/types/layers";
import { childrenOf } from "@/types/layers";
import {
  MaskRasterCache,
  PaintRasterCache,
  rasterizeImageLayer,
  rasterizeShapeLayer,
  rasterizeTextLayer,
  canvasVersion,
  type AssetSource,
  type Canvas2D,
} from "@/engine/layers/raster";
import { viewKey, type View } from "@/engine/layers/view";
import { RetouchRenderer } from "./RetouchRenderer";

const HEADER = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uSize;
out vec4 o;
`;

const BLEND_FS = `${HEADER}
uniform sampler2D uDst, uSrc, uMask;
uniform bool uHasMask;
uniform float uOpacity;
uniform int uMode;
${BLEND_GLSL}
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 d = texture(uDst, uv);
  vec4 s = texture(uSrc, uv) * uOpacity * (uHasMask ? texture(uMask, uv).a : 1.0);
  o = compositeP(uMode, d, s);
}`;

const ADJUST_FS = `${HEADER}
uniform sampler2D uSrc;
${ADJUST_GLSL}
void main(){
  vec4 c = texture(uSrc, gl_FragCoord.xy / uSize);
  vec3 straight = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  o = vec4(adjustColor(straight) * c.a, c.a);
}`;

/** Final output: optional before/after split, mask preview, and (un)premultiply. */
const PRESENT_FS = `${HEADER}
uniform sampler2D uTex, uBefore, uMaskTex;
uniform bool uSplit, uUnpremultiply;
uniform float uSplitX;
uniform int uMaskView; // 0 none, 1 greyscale mask, 2 red overlay
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 c = (uSplit && uv.x < uSplitX) ? texture(uBefore, uv) : texture(uTex, uv);
  if (uMaskView == 1) { float m = texture(uMaskTex, uv).a; c = vec4(vec3(m), 1.0); }
  else if (uMaskView == 2) { float m = texture(uMaskTex, uv).a; c = vec4(mix(c.rgb, vec3(1.0, 0.1, 0.1) * c.a, (1.0 - m) * 0.5), c.a); }
  o = uUnpremultiply ? (c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0)) : c;
}`;

export type DevelopInput = Omit<RenderOptions, "target" | "width" | "height" | "splitX">;

export interface CompositeInput {
  develop: DevelopInput;
  layers: LayerDoc[];
  view: View;
  assets: AssetSource;
  /** Ignore layers and edits (the "before" image). */
  before?: boolean;
}

interface TexEntry {
  canvas: Canvas2D;
  version: number;
  tex: WebGLTexture;
}

export class GLCompositor {
  private readonly r: WebGLRenderer;
  private readonly gl: WebGL2RenderingContext;
  private progBlend: WebGLProgram;
  private progAdjust: WebGLProgram;
  private progPresent: WebGLProgram;
  private pool: Target[] = [];
  private live: Target[] = [];
  private contentCache = new Map<string, { layer: LayerDoc; key: string; canvas: Canvas2D }>();
  private paintCache = new PaintRasterCache();
  private maskCache = new MaskRasterCache();
  private textures = new Map<string, TexEntry>();
  private blank: WebGLTexture;
  readonly retouch: RetouchRenderer;

  constructor(renderer: WebGLRenderer) {
    this.r = renderer;
    this.gl = renderer.gl;
    this.progBlend = renderer.program(BLEND_FS);
    this.progAdjust = renderer.program(ADJUST_FS);
    this.progPresent = renderer.program(PRESENT_FS);
    const gl = this.gl;
    this.blank = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.retouch = new RetouchRenderer(renderer, this);
  }

  // --- buffers ---------------------------------------------------------------

  /** Borrow a render-sized float target; all borrowed targets are returned by endFrame(). */
  acquire(w: number, h: number, clear = true): Target {
    const i = this.pool.findIndex((t) => t.w === w && t.h === h);
    const t = i >= 0 ? this.pool.splice(i, 1)[0] : this.r.createTarget(w, h);
    this.live.push(t);
    if (clear) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    return t;
  }

  release(t: Target) {
    const i = this.live.indexOf(t);
    if (i >= 0) this.live.splice(i, 1);
    this.pool.push(t);
  }

  private frameStart = new Set<Target>();

  /** Release every target acquired during this frame except `keep` (outputs stay live until released). */
  private endFrame(keep: Target[]) {
    for (const t of [...this.live]) if (!keep.includes(t) && !this.frameStart.has(t)) this.release(t);
    // Bound pool growth.
    while (this.pool.length > 8) this.r.releaseTarget(this.pool.shift()!);
  }

  /** Upload (or reuse) a canvas as a texture, flipped to match bottom-up render targets. */
  uploadCanvas(key: string, canvas: Canvas2D, version = 0): WebGLTexture {
    const gl = this.gl;
    let e = this.textures.get(key);
    if (e && e.canvas === canvas && e.version === version) return e.tex;
    if (!e) {
      const tex = gl.createTexture()!;
      e = { canvas, version: -1, tex };
      this.textures.set(key, e);
    }
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    e.canvas = canvas;
    e.version = version;
    return e.tex;
  }

  // --- passes ------------------------------------------------------------------

  blend(dst: Target, src: WebGLTexture, mode: BlendMode, opacity: number, mask: WebGLTexture | null): Target {
    const out = this.acquire(dst.w, dst.h, false);
    const gl = this.gl;
    const p = this.progBlend;
    gl.useProgram(p);
    this.r.bindTex(0, dst.tex);
    this.r.bindTex(1, src);
    this.r.bindTex(2, mask ?? this.blank);
    gl.uniform1i(this.r.u(p, "uDst"), 0);
    gl.uniform1i(this.r.u(p, "uSrc"), 1);
    gl.uniform1i(this.r.u(p, "uMask"), 2);
    gl.uniform1i(this.r.u(p, "uHasMask"), mask ? 1 : 0);
    gl.uniform1f(this.r.u(p, "uOpacity"), opacity);
    gl.uniform1i(this.r.u(p, "uMode"), BLEND_MODE_INDEX[mode]);
    gl.uniform2f(this.r.u(p, "uSize"), dst.w, dst.h);
    this.r.draw(out, dst.w, dst.h);
    this.release(dst);
    return out;
  }

  adjust(src: Target, a: AdjustmentParams): Target {
    const out = this.acquire(src.w, src.h, false);
    const u = adjustUniforms(a);
    const gl = this.gl;
    const p = this.progAdjust;
    gl.useProgram(p);
    this.r.bindTex(0, src.tex);
    gl.uniform1i(this.r.u(p, "uSrc"), 0);
    gl.uniform2f(this.r.u(p, "uSize"), src.w, src.h);
    gl.uniform1f(this.r.u(p, "uAExposure"), u.exposureMul);
    gl.uniform3fv(this.r.u(p, "uAWb"), u.wb);
    gl.uniform1f(this.r.u(p, "uAContrast"), u.contrast);
    gl.uniform1f(this.r.u(p, "uAHighlights"), u.highlights);
    gl.uniform1f(this.r.u(p, "uAShadows"), u.shadows);
    gl.uniform1f(this.r.u(p, "uASaturation"), u.saturation);
    gl.uniform1f(this.r.u(p, "uAHue"), u.hue);
    this.r.draw(out, src.w, src.h);
    return out;
  }

  /** Draw `t` to the canvas (or into an 8-bit target for read-back). */
  present(
    t: Target,
    opts: {
      into?: Target;
      before?: Target | null;
      splitX?: number | null;
      maskView?: 0 | 1 | 2;
      maskTex?: WebGLTexture | null;
      unpremultiply?: boolean;
    } = {},
  ) {
    const gl = this.gl;
    const p = this.progPresent;
    if (!opts.into) {
      const c = this.r.canvas;
      if (c.width !== t.w) c.width = t.w;
      if (c.height !== t.h) c.height = t.h;
    }
    gl.useProgram(p);
    this.r.bindTex(0, t.tex);
    this.r.bindTex(1, opts.before?.tex ?? t.tex);
    this.r.bindTex(2, opts.maskTex ?? this.blank);
    gl.uniform1i(this.r.u(p, "uTex"), 0);
    gl.uniform1i(this.r.u(p, "uBefore"), 1);
    gl.uniform1i(this.r.u(p, "uMaskTex"), 2);
    gl.uniform1i(this.r.u(p, "uSplit"), opts.before && opts.splitX != null ? 1 : 0);
    gl.uniform1f(this.r.u(p, "uSplitX"), opts.splitX ?? 0);
    gl.uniform1i(this.r.u(p, "uMaskView"), opts.maskTex ? (opts.maskView ?? 0) : 0);
    gl.uniform1i(this.r.u(p, "uUnpremultiply"), opts.unpremultiply ? 1 : 0);
    gl.uniform2f(this.r.u(p, "uSize"), t.w, t.h);
    this.r.draw(opts.into ?? null, t.w, t.h);
  }

  // --- content -----------------------------------------------------------------

  /** Rasterised content texture for an image/text/shape/paint layer in the view. */
  private contentTexture(layer: LayerDoc, view: View, viewK: string, assets: AssetSource): WebGLTexture | null {
    if (layer.kind === "paint") {
      const { canvas, version } = this.paintCache.get(layer.id, layer.ops, view, viewK, assets);
      return this.uploadCanvas(`content:${layer.id}`, canvas, version);
    }
    const cached = this.contentCache.get(layer.id);
    let canvas: Canvas2D;
    if (cached && cached.layer === layer && cached.key === viewK) canvas = cached.canvas;
    else {
      if (layer.kind === "image") canvas = rasterizeImageLayer(layer, view, assets);
      else if (layer.kind === "text") canvas = rasterizeTextLayer(layer, view);
      else if (layer.kind === "shape") canvas = rasterizeShapeLayer(layer, view);
      else return null;
      this.contentCache.set(layer.id, { layer, key: viewK, canvas });
    }
    return this.uploadCanvas(`content:${layer.id}`, canvas, 0);
  }

  /** Mask texture for a layer (null when it has no active mask). */
  maskTexture(
    id: string,
    mask: MaskDoc | null,
    enabled: boolean,
    feather: number,
    view: View,
    viewK: string,
    assets: AssetSource,
  ): WebGLTexture | null {
    if (!mask || !enabled) return null;
    const canvas = this.maskCache.get(id, mask, view, viewK, assets, feather);
    return this.uploadCanvas(`mask:${id}:${feather}`, canvas, canvasVersion(canvas));
  }

  private renderLayer(
    layer: LayerDoc,
    accum: Target,
    all: LayerDoc[],
    view: View,
    viewK: string,
    assets: AssetSource,
  ): Target {
    if (!layer.visible || layer.opacity <= 0) return accum;
    const mask = this.maskTexture(layer.id, layer.mask, layer.maskEnabled, layer.maskFeather, view, viewK, assets);
    const opacity = layer.opacity / 100;
    switch (layer.kind) {
      case "adjustment": {
        if (isIdentityAdjustment(layer.adjustment)) return accum;
        const adj = this.adjust(accum, layer.adjustment);
        const out = this.blend(accum, adj.tex, layer.blendMode, opacity, mask);
        this.release(adj);
        return out;
      }
      case "retouch": {
        if (!layer.ops.length) return accum;
        const res = this.retouch.apply(accum, layer.ops, view, assets);
        const out = this.blend(accum, res.tex, "normal", opacity, mask);
        this.release(res);
        return out;
      }
      case "group": {
        let g = this.acquire(accum.w, accum.h);
        for (const child of childrenOf(all, layer.id)) g = this.renderLayer(child, g, all, view, viewK, assets);
        const out = this.blend(accum, g.tex, layer.blendMode, opacity, mask);
        this.release(g);
        return out;
      }
      case "base":
        return accum;
      default: {
        const tex = this.contentTexture(layer, view, viewK, assets);
        if (!tex) return accum;
        return this.blend(accum, tex, layer.blendMode, opacity, mask);
      }
    }
  }

  /**
   * Render the whole document for `view`. Returns a premultiplied float target
   * owned by the caller, who must release() it when done.
   */
  composite(input: CompositeInput): Target {
    const { view, layers, assets } = input;
    const viewK = viewKey(view);
    this.frameStart = new Set(this.live);
    const base = this.acquire(view.width, view.height, false);
    this.r.render({
      ...input.develop,
      width: view.width,
      height: view.height,
      before: input.before,
      target: base,
      splitX: null,
    });
    if (input.before) {
      this.endFrame([base]);
      return base;
    }
    const b = layers[0];
    let accum = this.acquire(view.width, view.height);
    if (b && b.kind === "base") {
      if (b.visible && b.opacity > 0) {
        const mask = this.maskTexture(b.id, b.mask, b.maskEnabled, b.maskFeather, view, viewK, assets);
        accum = this.blend(accum, base.tex, "normal", b.opacity / 100, mask);
      }
    }
    this.release(base);
    for (const layer of childrenOf(layers, null)) {
      if (layer.kind === "base") continue;
      accum = this.renderLayer(layer, accum, layers, view, viewK, assets);
    }
    this.endFrame([accum]);
    return accum;
  }

  /** Forget cached rasters (e.g. when the source image changes). */
  clearCaches() {
    this.contentCache.clear();
    this.paintCache.clear();
    this.maskCache.clear();
  }

  dispose() {
    for (const t of [...this.pool, ...this.live]) this.r.releaseTarget(t);
    for (const e of this.textures.values()) this.gl.deleteTexture(e.tex);
    this.pool = [];
    this.live = [];
    this.textures.clear();
    this.retouch.dispose();
  }
}
