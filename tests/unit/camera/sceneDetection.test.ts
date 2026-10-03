import { describe, expect, it } from "vitest";
import { analyzeFrame } from "@/camera/frameAnalysis";
import { classifyScene, sceneStatusText } from "@/camera/sceneDetection";
import { makeFrame, rng, solid } from "./helpers";

const W = 48;
const H = 36;
const midScene = () => {
  const r = rng(7);
  return makeFrame(W, H, () => {
    const v = 90 + r() * 80;
    return [v, v * 0.97, v * 0.93];
  });
};

describe("scene detection", () => {
  it("never reports portrait without detected faces", () => {
    const stats = analyzeFrame(midScene(), W, H);
    expect(classifyScene({ stats, faces: null, motion: 0 }).scene).not.toBe("portrait");
    expect(classifyScene({ stats, faces: [], motion: 0 }).scene).not.toBe("portrait");
  });

  it("reports portrait with one face and group portrait with several", () => {
    const stats = analyzeFrame(midScene(), W, H);
    const face = { x: 0.4, y: 0.3, width: 0.2, height: 0.3 };
    expect(classifyScene({ stats, faces: [face], motion: 0 }).scene).toBe("portrait");
    const g = classifyScene({ stats, faces: [face, face, face], motion: 0 });
    expect(g.scene).toBe("group-portrait");
    expect(sceneStatusText(g)).toContain("3 faces");
  });

  it("flags face detection as unavailable when faces is null", () => {
    const stats = analyzeFrame(midScene(), W, H);
    expect(classifyScene({ stats, faces: null, motion: 0 }).faceDetection).toBe("unavailable");
  });

  it("detects night and low light", () => {
    expect(classifyScene({ stats: analyzeFrame(solid(W, H, 8), W, H), faces: null, motion: 0 }).scene).toBe("night");
    const low = classifyScene({ stats: analyzeFrame(solid(W, H, 40), W, H), faces: null, motion: 0 });
    expect(low.scene).toBe("low-light");
    expect(low.lowLight).toBe(true);
  });

  it("detects moving subjects", () => {
    const stats = analyzeFrame(midScene(), W, H);
    expect(classifyScene({ stats, faces: null, motion: 0.2 }).scene).toBe("sports");
  });

  it("detects backlit scenes", () => {
    const d = makeFrame(W, H, (x, y) => (x > 14 && x < 34 && y > 10 && y < 26 ? [25, 22, 20] : [252, 252, 250]));
    const r = classifyScene({ stats: analyzeFrame(d, W, H), faces: null, motion: 0 });
    expect([r.scene, ...r.flags]).toContain("backlit");
  });

  it("detects landscapes with blue sky", () => {
    const d = makeFrame(W, H, (_x, y) => (y < H / 2 ? [110, 160, 235] : [70, 120, 50]));
    expect(classifyScene({ stats: analyzeFrame(d, W, H), faces: null, motion: 0 }).scene).toBe("landscape");
  });

  it("detects documents (white paper with text)", () => {
    const d = makeFrame(W, H, (x, y) =>
      y % 4 === 0 && x % 3 !== 0 && x > 4 && x < W - 4 ? [30, 30, 30] : [235, 235, 232],
    );
    expect(classifyScene({ stats: analyzeFrame(d, W, H), faces: null, motion: 0 }).scene).toBe("document");
  });

  it("detects sunsets", () => {
    const d = makeFrame(W, H, (_x, y) => (y < H / 2 ? [235, 120, 40] : [90, 40, 20]));
    expect(classifyScene({ stats: analyzeFrame(d, W, H), faces: null, motion: 0 }).scene).toBe("sunset");
  });
});
