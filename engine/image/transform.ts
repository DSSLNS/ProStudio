/**
 * Geometry for the non-destructive pipeline. Everything reduces to one 3×3
 * projective matrix mapping OUTPUT pixel coordinates to SOURCE pixel
 * coordinates, so rendering is a single inverse-mapped resample of the
 * original — no intermediate resampled copies, no quality loss from chaining.
 *
 * Spaces:
 *   source    — the decoded original (already EXIF-oriented), srcW × srcH
 *   oriented  — after quarter-turn rotation and flips, W × H
 *   warped    — oriented after straighten/perspective/skew/scale about centre (same W × H canvas)
 *   output    — the crop rectangle of `warped`, scaled to the render size
 */
import type { CropRect, Geometry } from "@/types/edit";

export type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

export const identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("Singular transform");
  const inv = 1 / det;
  return [
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ];
}

export function apply(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

export const translate = (tx: number, ty: number): Mat3 => [1, 0, tx, 0, 1, ty, 0, 0, 1];
export const scaleM = (sx: number, sy: number): Mat3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1];
export const rotateM = (rad: number): Mat3 => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/** Homography mapping four source points onto four destination points. */
export function homographyFromPoints(src: [number, number][], dst: [number, number][]): Mat3 {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    const p = A[col][col];
    if (Math.abs(p) < 1e-12) throw new Error("Degenerate perspective");
    for (let c = col; c < 9; c++) A[col][c] /= p;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
}

export function orientedSize(
  srcW: number,
  srcH: number,
  g: Pick<Geometry, "rotation">,
): { width: number; height: number } {
  return g.rotation === 90 || g.rotation === 270 ? { width: srcH, height: srcW } : { width: srcW, height: srcH };
}

/** Maps oriented-space pixels → source pixels (quarter turns + flips). */
export function orientedToSource(srcW: number, srcH: number, g: Pick<Geometry, "rotation" | "flipH" | "flipV">): Mat3 {
  const { width: W, height: H } = orientedSize(srcW, srcH, g);
  // Undo flips (in oriented space).
  let m = identity();
  if (g.flipH) m = mul(m, [-1, 0, W, 0, 1, 0, 0, 0, 1]);
  if (g.flipV) m = mul(m, [1, 0, 0, 0, -1, H, 0, 0, 1]);
  // Undo clockwise rotation: oriented (x, y) → source.
  let r: Mat3;
  switch (g.rotation) {
    case 90:
      r = [0, 1, 0, -1, 0, srcH, 0, 0, 1]; // src = (y, srcH - x)
      break;
    case 180:
      r = [-1, 0, srcW, 0, -1, srcH, 0, 0, 1];
      break;
    case 270:
      r = [0, -1, srcW, 1, 0, 0, 0, 0, 1]; // src = (srcW - y, x)
      break;
    default:
      r = identity();
  }
  return mul(r, m);
}

/** Forward warp oriented → warped (straighten, perspective, skew, scale about centre). */
export function warpMatrix(W: number, H: number, g: Geometry): Mat3 {
  const cx = W / 2;
  const cy = H / 2;
  const v = g.perspectiveV / 100;
  const h = g.perspectiveH / 100;
  let persp = identity();
  if (v !== 0 || h !== 0) {
    const k = 0.25;
    const tl: [number, number] = [0, 0];
    const tr: [number, number] = [W, 0];
    const br: [number, number] = [W, H];
    const bl: [number, number] = [0, H];
    const dTop = Math.max(v, 0) * k * W;
    const dBot = Math.max(-v, 0) * k * W;
    const dLeft = Math.max(h, 0) * k * H;
    const dRight = Math.max(-h, 0) * k * H;
    persp = homographyFromPoints(
      [tl, tr, br, bl],
      [
        [tl[0] - dTop, tl[1] - dLeft],
        [tr[0] + dTop, tr[1] - dRight],
        [br[0] + dBot, br[1] + dRight],
        [bl[0] - dBot, bl[1] + dLeft],
      ],
    );
  }
  const skew: Mat3 = [
    1,
    Math.tan((g.skewX / 100) * (Math.PI / 6)),
    0,
    Math.tan((g.skewY / 100) * (Math.PI / 6)),
    1,
    0,
    0,
    0,
    1,
  ];
  const s = g.scale / 100;
  const about = mul(
    translate(cx, cy),
    mul(rotateM((g.straighten * Math.PI) / 180), mul(skew, mul(scaleM(s, s), translate(-cx, -cy)))),
  );
  return mul(about, persp);
}

export function effectiveCrop(g: Geometry): CropRect {
  return g.crop ?? { x: 0, y: 0, width: 1, height: 1 };
}

/** Full-resolution output size (crop of the oriented canvas). */
export function outputSize(srcW: number, srcH: number, g: Geometry): { width: number; height: number } {
  const { width: W, height: H } = orientedSize(srcW, srcH, g);
  const c = effectiveCrop(g);
  return { width: Math.max(1, Math.round(c.width * W)), height: Math.max(1, Math.round(c.height * H)) };
}

/**
 * Matrix mapping render-target pixels (renderW × renderH covering the whole
 * crop) to source pixels.
 */
export function outputToSourceMatrix(srcW: number, srcH: number, g: Geometry, renderW: number, renderH: number): Mat3 {
  const { width: W, height: H } = orientedSize(srcW, srcH, g);
  const c = effectiveCrop(g);
  const outToWarped = mul(translate(c.x * W, c.y * H), scaleM((c.width * W) / renderW, (c.height * H) / renderH));
  const warpedToOriented = invert(warpMatrix(W, H, g));
  return mul(orientedToSource(srcW, srcH, g), mul(warpedToOriented, outToWarped));
}

/** Source-pixel bounding box needed to render an output rectangle, expanded by `margin`. */
export function sourceBoundsForOutputRect(
  m: Mat3,
  rect: { x: number; y: number; width: number; height: number },
  srcW: number,
  srcH: number,
  margin: number,
): { x: number; y: number; width: number; height: number } | null {
  const pts = [
    apply(m, rect.x, rect.y),
    apply(m, rect.x + rect.width, rect.y),
    apply(m, rect.x, rect.y + rect.height),
    apply(m, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - margin));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - margin));
  const x1 = Math.min(srcW, Math.ceil(Math.max(...xs) + margin));
  const y1 = Math.min(srcH, Math.ceil(Math.max(...ys) + margin));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Largest axis-aligned crop (same aspect as `aspect`, centred) that stays inside a straightened image. */
export function maxInscribedCrop(W: number, H: number, degrees: number, aspect = W / H): CropRect {
  const a = Math.abs((degrees * Math.PI) / 180);
  if (a < 1e-6) return { x: 0, y: 0, width: 1, height: 1 };
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  // Width w, height w/aspect rectangle rotated by -a must fit inside W×H.
  const w = Math.min(W / (cos + sin / aspect), H / (sin + cos / aspect));
  const h = w / aspect;
  return { x: (W - w) / 2 / W, y: (H - h) / 2 / H, width: w / W, height: h / H };
}
