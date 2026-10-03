/** Adobe/Resolve .cube 3D LUT parsing and trilinear sampling. */

export interface CubeLut {
  title: string;
  size: number;
  /** RGB triplets, size^3 entries, red index fastest. */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export class LutParseError extends Error {}

const MAX_LUT_SIZE = 129;

export function parseCubeLut(text: string): CubeLut {
  let title = "";
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "").slice(0, 200);
    } else if (key === "LUT_3D_SIZE") {
      size = parseInt(parts[1], 10);
      if (!Number.isInteger(size) || size < 2 || size > MAX_LUT_SIZE)
        throw new LutParseError(`Unsupported LUT size ${parts[1]}.`);
    } else if (key === "LUT_1D_SIZE") {
      throw new LutParseError("1D .cube LUTs are not supported; please use a 3D LUT.");
    } else if (key === "DOMAIN_MIN" || key === "DOMAIN_MAX") {
      const v = parts.slice(1, 4).map(Number) as [number, number, number];
      if (v.length !== 3 || v.some((n) => !Number.isFinite(n))) throw new LutParseError("Invalid DOMAIN line.");
      if (key === "DOMAIN_MIN") domainMin = v;
      else domainMax = v;
    } else if (/^[-+.\d]/.test(parts[0])) {
      if (parts.length < 3) throw new LutParseError("Malformed LUT data line.");
      for (let k = 0; k < 3; k++) {
        const n = Number(parts[k]);
        if (!Number.isFinite(n)) throw new LutParseError("LUT contains a non-numeric value.");
        values.push(n);
      }
    }
    // Unknown keywords (e.g. LUT_IN_VIDEO_RANGE) are ignored.
  }
  if (!size) throw new LutParseError("LUT_3D_SIZE is missing.");
  if (values.length !== size ** 3 * 3) {
    throw new LutParseError(`Expected ${size ** 3} entries but found ${values.length / 3}.`);
  }
  return { title, size, data: Float32Array.from(values), domainMin, domainMax };
}

/** Trilinear sample of a cube LUT. Input is in the LUT's domain. */
export function sampleLut(
  lut: Pick<CubeLut, "size" | "data" | "domainMin" | "domainMax">,
  rgb: [number, number, number],
): [number, number, number] {
  const n = lut.size;
  const idx = rgb.map((v, k) => {
    const t = (v - lut.domainMin[k]) / (lut.domainMax[k] - lut.domainMin[k]);
    return Math.max(0, Math.min(1, t)) * (n - 1);
  });
  const i0 = idx.map((f) => Math.floor(f));
  const i1 = i0.map((i) => Math.min(n - 1, i + 1));
  const f = idx.map((v, k) => v - i0[k]);
  const at = (r: number, g: number, b: number, c: number) => lut.data[(r + g * n + b * n * n) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(i0[0], i0[1], i0[2], c) * (1 - f[0]) + at(i1[0], i0[1], i0[2], c) * f[0];
    const c10 = at(i0[0], i1[1], i0[2], c) * (1 - f[0]) + at(i1[0], i1[1], i0[2], c) * f[0];
    const c01 = at(i0[0], i0[1], i1[2], c) * (1 - f[0]) + at(i1[0], i0[1], i1[2], c) * f[0];
    const c11 = at(i0[0], i1[1], i1[2], c) * (1 - f[0]) + at(i1[0], i1[1], i1[2], c) * f[0];
    const c0 = c00 * (1 - f[1]) + c10 * f[1];
    const c1 = c01 * (1 - f[1]) + c11 * f[1];
    out[c] = c0 * (1 - f[2]) + c1 * f[2];
  }
  return out;
}
