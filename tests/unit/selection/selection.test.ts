import { describe, expect, it } from "vitest";
import { colorRange, combineSelection, coverageBounds, invertSelection, magicWand, modeFromModifiers, selectAll } from "@/engine/selection/selection";
import type { MaskOp } from "@/types/layers";

function image(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      d.set([r, g, b, 255], (y * w + x) * 4);
    }
  return d;
}

const rect: MaskOp = { type: "rect", mode: "add", x: 0, y: 0, w: 10, h: 10 };

describe("selection combination", () => {
  it("new replaces, add/subtract/intersect append with the right mode", () => {
    const a = combineSelection(null, rect, "new")!;
    expect(a).toEqual({ base: 0, ops: [rect] });
    const b = combineSelection(a, { ...rect, x: 5 }, "subtract")!;
    expect(b.ops[1]).toMatchObject({ mode: "subtract", x: 5 });
    const c = combineSelection(b, rect, "intersect")!;
    expect(c.ops[2]).toMatchObject({ mode: "intersect" });
    expect(combineSelection(a, rect, "new")).toEqual({ base: 0, ops: [rect] });
  });
  it("subtracting from nothing leaves nothing", () => {
    expect(combineSelection(null, rect, "subtract")).toBeNull();
  });
  it("modifiers map Shift/Alt like Photoshop", () => {
    expect(modeFromModifiers("new", true, false)).toBe("add");
    expect(modeFromModifiers("new", false, true)).toBe("subtract");
    expect(modeFromModifiers("new", true, true)).toBe("intersect");
    expect(modeFromModifiers("add", false, false)).toBe("add");
  });
  it("invert of nothing selects all", () => {
    expect(invertSelection(null)).toEqual(selectAll());
  });
});

describe("magic wand", () => {
  // Left half dark, right half bright, with a dark island on the right.
  const w = 20;
  const h = 10;
  const d = image(w, h, (x, y) => (x < 10 || (x >= 15 && x < 17 && y >= 4 && y < 6) ? [20, 20, 20] : [220, 220, 220]));
  it("contiguous fill stops at edges", () => {
    const m = magicWand(d, w, h, 2, 2, 10, true);
    expect(m.reduce((a, v) => a + (v ? 1 : 0), 0)).toBe(100);
    expect(m[5 * w + 15]).toBe(0); // island not reached
  });
  it("global mode selects every matching pixel", () => {
    const m = magicWand(d, w, h, 2, 2, 10, false);
    expect(m.reduce((a, v) => a + (v ? 1 : 0), 0)).toBe(104);
  });
  it("tolerance widens the match", () => {
    expect(magicWand(d, w, h, 2, 2, 255, true).every((v) => v === 255)).toBe(true);
  });
});

describe("colour range", () => {
  it("is soft: full inside half fuzziness, zero beyond", () => {
    const d = image(3, 1, (x) => (x === 0 ? [255, 0, 0] : x === 1 ? [235, 0, 0] : [0, 0, 255]));
    const m = colorRange(d, 3, 1, [255, 0, 0], 60);
    expect(m[0]).toBe(255);
    expect(m[1]).toBe(255);
    expect(m[2]).toBe(0);
  });
});

describe("coverage bounds", () => {
  it("finds the box and returns null when empty", () => {
    const c = new Uint8Array(25);
    expect(coverageBounds(c, 5, 5)).toBeNull();
    c[1 * 5 + 2] = 255;
    c[3 * 5 + 4] = 255;
    expect(coverageBounds(c, 5, 5)).toEqual({ x: 2, y: 1, w: 3, h: 3 });
  });
});
