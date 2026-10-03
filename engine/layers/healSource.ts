/**
 * Spot healing: automatically choose where to sample from. Candidate offsets on
 * rings around the defect are scored by how well the texture surrounding the
 * defect matches the texture around the candidate source (sum of squared
 * differences over a border band, ignoring the defect itself).
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function findHealSource(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  defect: Box, // render px
): [number, number] | null {
  const pad = Math.max(3, Math.round(Math.max(defect.w, defect.h) * 0.35));
  const region: Box = { x: defect.x - pad, y: defect.y - pad, w: defect.w + 2 * pad, h: defect.h + 2 * pad };
  const step = Math.max(1, Math.round(Math.max(region.w, region.h) / 48)); // subsample for speed
  const inDefect = (x: number, y: number) => x >= defect.x && x < defect.x + defect.w && y >= defect.y && y < defect.y + defect.h;
  const R = Math.max(defect.w, defect.h);
  let best: { off: [number, number]; score: number } | null = null;
  for (const dist of [1.3, 1.8, 2.4]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.round(Math.cos(a) * R * dist);
      const dy = Math.round(Math.sin(a) * R * dist);
      if (region.x + dx < 0 || region.y + dy < 0 || region.x + region.w + dx > w || region.y + region.h + dy > h) continue;
      let score = 0;
      let n = 0;
      for (let y = region.y; y < region.y + region.h; y += step) {
        for (let x = region.x; x < region.x + region.w; x += step) {
          if (x < 0 || y < 0 || x >= w || y >= h || inDefect(x, y)) continue;
          const i = (y * w + x) * 4;
          const j = ((y + dy) * w + (x + dx)) * 4;
          const d0 = pixels[i] - pixels[j];
          const d1 = pixels[i + 1] - pixels[j + 1];
          const d2 = pixels[i + 2] - pixels[j + 2];
          score += d0 * d0 + d1 * d1 + d2 * d2;
          n++;
        }
      }
      if (!n) continue;
      // Slight preference for nearer sources (more similar lighting).
      score = (score / n) * (1 + 0.05 * dist);
      if (!best || score < best.score) best = { off: [dx, dy], score };
    }
  }
  return best?.off ?? null;
}
