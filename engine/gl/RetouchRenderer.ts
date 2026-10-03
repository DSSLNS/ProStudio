/**
 * Non-destructive retouching on the GPU. A retouch layer is a list of strokes;
 * every render re-applies them, in order, to a working copy of the image
 * beneath (so the original and all layers stay untouched):
 *
 *   coverage = Σ dabs (GPU quads, brush falloff, flow-accumulated) × clip
 *   W ← mix(W, effect(W), coverage × opacity)
 *
 * Effects:
 *   clone  W(p + offset)
 *   heal   W(p + o) − B(p + o) + B(p)   (texture from the source, tone/colour from the destination)
 *   dodge/burn  exposure ±, weighted by a shadows/midtones/highlights mask
 *   blur / sharpen  B, or W + k(W − B)
 *   dust   B where |W − B| exceeds a threshold (local dust & scratches)
 *   redeye desaturate/darken strongly red pixels
 *   smudge sequential: each dab pulls colour from the previous dab position
 */
import type { Target, WebGLRenderer } from "./WebGLRenderer";
import type { GLCompositor } from "./Compositor";
import type { RetouchOp } from "@/types/layers";
import type { AssetSource } from "@/engine/layers/raster";
import { canvasVersion, MaskRasterCache } from "@/engine/layers/raster";
import { strokeDabs } from "@/engine/layers/dabs";
import { viewKey, type View } from "@/engine/layers/view";

const DAB_VS = /* glsl */ `#version 300 es
in vec2 aPos;           // unit quad corner (-1..1)
uniform vec2 uCenter;   // render px (top-down)
uniform float uRadius;  // render px
uniform vec2 uSize;     // target size
out vec2 vLocal;
void main(){
  vLocal = aPos;
  vec2 p = uCenter + aPos * uRadius;
  vec2 ndc = vec2(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const DAB_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
uniform float uHardness, uFlow;
out vec4 o;
void main(){
  float d = length(vLocal);
  if (d > 1.0) discard;
  float a = d <= uHardness ? 1.0 : 1.0 - (d - uHardness) / max(1e-4, 1.0 - uHardness);
  o = vec4(0.0, 0.0, 0.0, a * uFlow);
}`;

const EFFECT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uW, uB, uC, uClip, uBw;
uniform bool uHasClip;
uniform vec2 uSize;
uniform int uMode;         // 0 clone 1 heal 2 dodge 3 burn 4 blur 5 sharpen 6 dust 7 redeye 8 skin
uniform vec2 uOffsetUv;    // source offset in uv (target space)
uniform float uStrength, uOpacity, uThreshold;
uniform int uRange;        // 0 shadows 1 midtones 2 highlights
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 unp(vec4 c){ return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 w = texture(uW, uv);
  float cov = texture(uC, uv).a * uOpacity * (uHasClip ? texture(uClip, uv).a : 1.0);
  if (cov <= 0.0) { o = w; return; }
  vec4 e = w;
  if (uMode == 0) e = texture(uW, uv + uOffsetUv);
  else if (uMode == 1) {
    // Normalised convolution: low frequencies interpolated from outside the healed area only.
    vec4 lowDst = texture(uB, uv) / max(texture(uBw, uv).r, 1e-4);
    vec4 lowSrc = texture(uB, uv + uOffsetUv) / max(texture(uBw, uv + uOffsetUv).r, 1e-4);
    e = clamp(texture(uW, uv + uOffsetUv) - lowSrc + lowDst, 0.0, 1.0);
  }
  else if (uMode == 2 || uMode == 3) {
    vec3 c = unp(w); float y = luma(c);
    float wt = uRange == 0 ? 1.0 - smoothstep(0.0, 0.5, y) : uRange == 2 ? smoothstep(0.5, 1.0, y) : 1.0 - abs(2.0 * y - 1.0);
    float g = exp2((uMode == 2 ? 1.0 : -1.0) * uStrength * 1.2 * wt);
    e = vec4(clamp(c * g, 0.0, 1.0) * w.a, w.a);
  }
  else if (uMode == 4) e = texture(uB, uv);
  else if (uMode == 5) e = clamp(w + (w - texture(uB, uv)) * uStrength * 3.0, 0.0, 1.0);
  else if (uMode == 6) {
    vec4 b = texture(uB, uv);
    float d = abs(luma(unp(w)) - luma(unp(b)));
    e = d > uThreshold ? b : w;
  }
  else if (uMode == 7) {
    vec3 c = unp(w);
    float gb = 0.5 * (c.g + c.b);
    float red = c.r > 0.12 ? smoothstep(0.35, 0.6, (c.r - gb) / max(c.r, 1e-3)) : 0.0;
    vec3 fixedC = vec3(gb, c.g, c.b) * mix(1.0, 0.8, red);
    e = vec4(mix(c, fixedC, red) * w.a, w.a);
  }
  else if (uMode == 8) {
    // Texture-preserving skin smoothing: remove the mid-frequency band (blotches) only;
    // fine pore-level detail (above B) and overall shape/tone (below Bw) are kept.
    e = clamp(w - (texture(uB, uv) - texture(uBw, uv)) * uStrength, 0.0, 1.0);
  }
  o = mix(w, e, clamp(cov, 0.0, 1.0));
}`;

/** One smudge dab: pull colour from the previous dab position (scissored to the dab). */
const SMUDGE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uW, uClip;
uniform bool uHasClip;
uniform vec2 uSize, uCenter, uPrev;  // render px (target space, bottom-up)
uniform float uRadius, uHardness, uStrength;
out vec4 o;
void main(){
  vec2 p = gl_FragCoord.xy;
  vec2 uv = p / uSize;
  vec4 w = texture(uW, uv);
  float d = length(p - uCenter) / uRadius;
  float a = d > 1.0 ? 0.0 : d <= uHardness ? 1.0 : 1.0 - (d - uHardness) / max(1e-4, 1.0 - uHardness);
  a *= uStrength * (uHasClip ? texture(uClip, uv).a : 1.0);
  vec4 src = texture(uW, (p + (uPrev - uCenter)) / uSize);
  o = mix(w, src, a);
}`;

/** Weighted copy for normalised convolution: rgba × (1 − coverage) or the weight itself. */
const WEIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uW, uC;
uniform vec2 uSize;
uniform bool uWeightOnly;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  // Exclude every pixel the stroke touches, even partially, from the tone interpolation.
  float k = 1.0 - smoothstep(0.0, 0.15, texture(uC, uv).a);
  o = uWeightOnly ? vec4(k, 0.0, 0.0, 1.0) : texture(uW, uv) * k;
}`;

const MODE: Record<Exclude<RetouchOp["tool"], "smudge">, number> = {
  clone: 0,
  heal: 1,
  dodge: 2,
  burn: 3,
  blur: 4,
  sharpen: 5,
  dust: 6,
  redeye: 7,
  skin: 8,
};

export class RetouchRenderer {
  private readonly gl: WebGL2RenderingContext;
  private dabProg: WebGLProgram;
  private effectProg: WebGLProgram;
  private smudgeProg: WebGLProgram;
  private weightProg: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private clipCache = new MaskRasterCache();

  constructor(
    private readonly r: WebGLRenderer,
    private readonly c: GLCompositor,
  ) {
    this.gl = r.gl;
    this.dabProg = this.link(DAB_VS, DAB_FS);
    this.effectProg = r.program(EFFECT_FS);
    this.smudgeProg = r.program(SMUDGE_FS);
    this.weightProg = r.program(WEIGHT_FS);
    const gl = this.gl;
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.dabProg, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (t: number, src: string) => {
      const s = gl.createShader(t)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Retouch shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Retouch link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }

  /** Rasterise a stroke's coverage into an 8-bit target with GPU dab quads. */
  private coverage(op: RetouchOp, view: View, w: number, h: number): Target {
    const gl = this.gl;
    const t = this.c.acquire(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.dabProg);
    gl.bindVertexArray(this.quad);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // alpha accumulates like paint
    const u = (n: string) => this.r.u(this.dabProg, n);
    gl.uniform2f(u("uSize"), w, h);
    gl.uniform1f(u("uHardness"), Math.min(0.999, op.brush.hardness));
    for (const d of strokeDabs(op.points, op.brush)) {
      const x = (d.x - view.originX) * view.scale;
      const y = (d.y - view.originY) * view.scale;
      const r = Math.max(0.5, (d.size / 2) * view.scale);
      if (x + r < 0 || y + r < 0 || x - r > w || y - r > h) continue;
      gl.uniform2f(u("uCenter"), x, y);
      gl.uniform1f(u("uRadius"), r);
      gl.uniform1f(u("uFlow"), d.flow);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
    return t;
  }

  private opIds = new WeakMap<RetouchOp, string>();
  private nextOpId = 0;

  private clipTexture(op: RetouchOp, view: View, assets: AssetSource): WebGLTexture | null {
    if (!op.clip) return null;
    let id = this.opIds.get(op);
    if (!id) this.opIds.set(op, (id = `retouch-clip-${this.nextOpId++}`));
    const canvas = this.clipCache.get(id, op.clip, view, viewKey(view), assets, 0);
    return this.c.uploadCanvas(id, canvas, canvasVersion(canvas));
  }

  /** Effect blur radius in frame px for ops that need a low-pass copy. */
  private blurSigma(op: RetouchOp): number {
    switch (op.tool) {
      case "heal":
        return Math.max(2, op.brush.size / 3);
      case "blur":
        return 1 + op.strength * 12;
      case "sharpen":
        return 1.5;
      case "dust":
        return 3;
      default:
        return 0;
    }
  }

  apply(accum: Target, ops: RetouchOp[], view: View, assets: AssetSource): Target {
    const w = accum.w;
    const h = accum.h;
    let W = this.c.acquire(w, h, false);
    this.c.present(accum, { into: W });
    for (const op of ops) {
      if (op.points.length < 3) continue;
      const clip = this.clipTexture(op, view, assets);
      if (op.tool === "smudge") {
        W = this.smudge(W, op, view, clip);
        continue;
      }
      const cov = this.coverage(op, view, w, h);
      const sigma = Math.max(0.6, this.blurSigma(op) * view.scale);
      let B: Target | null = null;
      let Bw: Target | null = null;
      if (op.tool === "heal") {
        const masked = this.weighted(W, cov, false);
        const weight = this.weighted(W, cov, true);
        B = this.r.blur(masked, sigma);
        Bw = this.r.blur(weight, sigma);
        this.c.release(masked);
        this.c.release(weight);
      } else if (op.tool === "skin") {
        // Band-pass between ~0.25% and ~1.2% of the frame's short side (at full resolution).
        const short = Math.min(w, h) / view.scale;
        B = this.r.blur(W, Math.max(0.6, short * 0.0025 * view.scale));
        Bw = this.r.blur(W, Math.max(1, short * 0.012 * view.scale));
      } else if (this.blurSigma(op) > 0) {
        B = this.r.blur(W, sigma);
      }
      const out = this.c.acquire(w, h, false);
      const gl = this.gl;
      const p = this.effectProg;
      const u = (n: string) => this.r.u(p, n);
      gl.useProgram(p);
      this.r.bindTex(0, W.tex);
      this.r.bindTex(1, (B ?? W).tex);
      this.r.bindTex(2, cov.tex);
      this.r.bindTex(3, clip ?? W.tex);
      this.r.bindTex(4, (Bw ?? W).tex);
      gl.uniform1i(u("uBw"), 4);
      gl.uniform1i(u("uW"), 0);
      gl.uniform1i(u("uB"), 1);
      gl.uniform1i(u("uC"), 2);
      gl.uniform1i(u("uClip"), 3);
      gl.uniform1i(u("uHasClip"), clip ? 1 : 0);
      gl.uniform2f(u("uSize"), w, h);
      gl.uniform1i(u("uMode"), MODE[op.tool]);
      const off = op.offset ?? [0, 0];
      // Targets are bottom-up, so a downward (positive y) frame offset is negative in uv.
      gl.uniform2f(u("uOffsetUv"), (off[0] * view.scale) / w, (-off[1] * view.scale) / h);
      gl.uniform1f(u("uStrength"), op.strength);
      gl.uniform1f(u("uOpacity"), op.brush.opacity);
      gl.uniform1f(u("uThreshold"), op.threshold ?? 0.1);
      gl.uniform1i(u("uRange"), op.range === "shadows" ? 0 : op.range === "highlights" ? 2 : 1);
      this.r.draw(out, w, h);
      if (B) this.r.releaseTarget(B);
      if (Bw) this.r.releaseTarget(Bw);
      this.c.release(cov);
      this.c.release(W);
      W = out;
    }
    return W;
  }

  private weighted(W: Target, cov: Target, weightOnly: boolean): Target {
    const out = this.c.acquire(W.w, W.h, false);
    const gl = this.gl;
    const p = this.weightProg;
    gl.useProgram(p);
    this.r.bindTex(0, W.tex);
    this.r.bindTex(1, cov.tex);
    gl.uniform1i(this.r.u(p, "uW"), 0);
    gl.uniform1i(this.r.u(p, "uC"), 1);
    gl.uniform2f(this.r.u(p, "uSize"), W.w, W.h);
    gl.uniform1i(this.r.u(p, "uWeightOnly"), weightOnly ? 1 : 0);
    this.r.draw(out, W.w, W.h);
    return out;
  }

  private smudge(W: Target, op: RetouchOp, view: View, clip: WebGLTexture | null): Target {
    const gl = this.gl;
    const w = W.w;
    const h = W.h;
    let cur = W;
    let other = this.c.acquire(w, h, false);
    this.c.present(cur, { into: other });
    const dabs = strokeDabs(op.points, op.brush);
    const p = this.smudgeProg;
    const u = (n: string) => this.r.u(p, n);
    gl.enable(gl.SCISSOR_TEST);
    for (let i = 1; i < dabs.length; i++) {
      const d = dabs[i];
      const prev = dabs[i - 1];
      const r = Math.max(0.5, (d.size / 2) * view.scale);
      const cx = (d.x - view.originX) * view.scale;
      const cy = h - (d.y - view.originY) * view.scale;
      const px = (prev.x - view.originX) * view.scale;
      const py = h - (prev.y - view.originY) * view.scale;
      const x0 = Math.max(0, Math.floor(cx - r - 1));
      const y0 = Math.max(0, Math.floor(cy - r - 1));
      const sw = Math.min(w, Math.ceil(cx + r + 1)) - x0;
      const sh = Math.min(h, Math.ceil(cy + r + 1)) - y0;
      if (sw <= 0 || sh <= 0) continue;
      gl.scissor(x0, y0, sw, sh);
      gl.useProgram(p);
      this.r.bindTex(0, cur.tex);
      this.r.bindTex(1, clip ?? cur.tex);
      gl.uniform1i(u("uW"), 0);
      gl.uniform1i(u("uClip"), 1);
      gl.uniform1i(u("uHasClip"), clip ? 1 : 0);
      gl.uniform2f(u("uSize"), w, h);
      gl.uniform2f(u("uCenter"), cx, cy);
      gl.uniform2f(u("uPrev"), px, py);
      gl.uniform1f(u("uRadius"), r);
      gl.uniform1f(u("uHardness"), Math.min(0.999, op.brush.hardness));
      gl.uniform1f(u("uStrength"), op.strength * op.brush.opacity);
      this.r.draw(other, w, h);
      // Swap, then copy the dab area back so both buffers agree before the next dab.
      [cur, other] = [other, cur];
      this.c.present(cur, { into: other });
    }
    gl.disable(gl.SCISSOR_TEST);
    this.c.release(other);
    return cur;
  }

  dispose() {
    this.clipCache.clear();
  }
}
