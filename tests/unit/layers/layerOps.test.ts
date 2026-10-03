import { describe, expect, it } from "vitest";
import {
  displayRows,
  duplicateLayer,
  groupLayer,
  insertLayer,
  makeAdjustmentLayer,
  makeGroupLayer,
  makePaintLayer,
  moveLayer,
  nudgeLayer,
  patchLayer,
  removeLayer,
  ungroupLayer,
} from "@/engine/layers/layerOps";
import {
  baseLayer,
  collectAssetIds,
  fixLayerStack,
  isTrivialStack,
  normalizeLayers,
  type LayerDoc,
} from "@/types/layers";

const names = (ls: LayerDoc[]) => ls.map((l) => l.name);

function stack() {
  const a = { ...makePaintLayer("A") };
  const b = { ...makePaintLayer("B") };
  const c = { ...makeAdjustmentLayer("C") };
  return { a, b, c, layers: [baseLayer(), a, b, c] as LayerDoc[] };
}

describe("layer stack operations", () => {
  it("inserts above a target and at the top", () => {
    const { a, layers } = stack();
    const n = makePaintLayer("N");
    expect(names(insertLayer(layers, n, a.id))).toEqual(["Background", "A", "N", "B", "C"]);
    expect(names(insertLayer(layers, n))).toEqual(["Background", "A", "B", "C", "N"]);
  });

  it("never removes the base layer; removes groups with children", () => {
    const { layers } = stack();
    expect(removeLayer(layers, "base")).toBe(layers);
    const g = makeGroupLayer("G");
    const withGroup = [...layers, g, { ...makePaintLayer("child"), parentId: g.id }];
    expect(names(removeLayer(withGroup, g.id))).toEqual(["Background", "A", "B", "C"]);
  });

  it("moves layers by drag-and-drop and keeps the base at the bottom", () => {
    const { a, c, layers } = stack();
    expect(names(moveLayer(layers, a.id, c.id, "above"))).toEqual(["Background", "B", "C", "A"]);
    expect(names(moveLayer(layers, c.id, a.id, "below"))).toEqual(["Background", "C", "A", "B"]);
    expect(names(moveLayer(layers, c.id, "base", "below"))).toEqual(["Background", "C", "A", "B"]);
    expect(moveLayer(layers, "base", c.id, "above")).toBe(layers);
  });

  it("drops into groups and refuses cycles", () => {
    const { a, layers } = stack();
    const g = makeGroupLayer("G");
    const l = moveLayer([...layers, g], a.id, g.id, "inside");
    expect(l.find((x) => x.id === a.id)!.parentId).toBe(g.id);
    expect(moveLayer(l, g.id, a.id, "inside")).toBe(l);
  });

  it("nudges among siblings", () => {
    const { a, layers } = stack();
    expect(names(nudgeLayer(layers, a.id, 1))).toEqual(["Background", "B", "A", "C"]);
    expect(nudgeLayer(layers, a.id, -1)).toBe(layers);
  });

  it("duplicates a group subtree with fresh ids", () => {
    const { layers } = stack();
    const { layers: grouped, groupId } = groupLayer(layers, layers[1].id, "G");
    const { layers: dup, newId } = duplicateLayer(grouped, groupId!);
    expect(newId).not.toBe(groupId);
    const copyChild = dup.find((l) => l.parentId === newId);
    expect(copyChild?.name).toBe("A");
    expect(new Set(dup.map((l) => l.id)).size).toBe(dup.length);
  });

  it("ungroups to the parent level", () => {
    const { a, layers } = stack();
    const { layers: grouped, groupId } = groupLayer(layers, a.id, "G");
    const out = ungroupLayer(grouped, groupId!);
    expect(out.find((l) => l.id === a.id)!.parentId).toBeNull();
    expect(out.some((l) => l.id === groupId)).toBe(false);
  });

  it("display rows list top-most first with depth", () => {
    const { a, layers } = stack();
    const { layers: grouped } = groupLayer(layers, a.id, "G");
    expect(displayRows(grouped).map((r) => `${r.layer.name}:${r.depth}`)).toEqual([
      "C:0",
      "B:0",
      "G:0",
      "A:1",
      "Background:0",
    ]);
  });

  it("patches immutably and keeps other layers' identity", () => {
    const { a, b, layers } = stack();
    const out = patchLayer(layers, a.id, { opacity: 50 });
    expect(out.find((l) => l.id === a.id)!.opacity).toBe(50);
    expect(out.find((l) => l.id === b.id)).toBe(b);
    expect(a.opacity).toBe(100);
  });
});

describe("layer validation", () => {
  it("adds a base layer to legacy empty stacks", () => {
    const l = normalizeLayers([]);
    expect(l).toHaveLength(1);
    expect(l[0].kind).toBe("base");
    expect(isTrivialStack(l)).toBe(true);
  });

  it("drops invalid layers, duplicate ids, bad parents and unknown assets", () => {
    const out = normalizeLayers(
      [
        { id: "x", kind: "paint", ops: [{ tool: "brush", points: [1, 2, 0.5], brush: {}, color: "#ff0000" }] },
        { id: "x", kind: "paint", ops: [] },
        { id: "img", kind: "image", assetId: "nope", placement: {} },
        { id: "y", kind: "text", text: "hi", parentId: "missing", blendMode: "evil" },
        { id: "z", kind: "script" },
        "garbage",
      ],
      (id) => (id === "known" ? "known" : null),
    );
    expect(out.map((l) => l.id)).toEqual(["base", "x", "y"]);
    expect(out[2].parentId).toBeNull();
    expect(out[2].blendMode).toBe("normal");
  });

  it("validates mask ops and remaps raster assets", () => {
    const [, l] = normalizeLayers(
      [
        {
          id: "a",
          kind: "adjustment",
          adjustment: { exposure: 99 },
          mask: {
            base: 0,
            ops: [
              { type: "raster", mode: "add", assetId: "old", x: 0, y: 0, w: 10, h: 10 },
              { type: "nope" },
              { type: "feather", radius: 4 },
            ],
          },
        },
      ],
      (id) => (id === "old" ? "new" : null),
    );
    expect(l.kind === "adjustment" && l.adjustment.exposure).toBe(5);
    expect(l.mask?.ops).toEqual([
      { type: "raster", mode: "add", assetId: "new", x: 0, y: 0, w: 10, h: 10 },
      { type: "feather", radius: 4 },
    ]);
    expect([...collectAssetIds([l])]).toEqual(["new"]);
  });

  it("breaks parent cycles", () => {
    const g1 = { ...makeGroupLayer("g1"), id: "g1", parentId: "g2" };
    const g2 = { ...makeGroupLayer("g2"), id: "g2", parentId: "g1" };
    const out = fixLayerStack([baseLayer(), g1, g2]);
    expect(out.filter((l) => l.parentId === null).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps unchanged layers' identity (history sharing)", () => {
    const p = makePaintLayer("p");
    const out = fixLayerStack([baseLayer(), p]);
    expect(out[1]).toBe(p);
  });
});
