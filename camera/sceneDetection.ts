/**
 * Heuristic scene classifier. It looks at simple frame statistics (brightness,
 * colour, edges, motion) plus — only when the browser provides it — real face
 * detection. It is an *estimate*; the UI labels it "Scene (estimated)".
 * Portrait / group portrait are only ever reported when faces were actually detected.
 */

import type { FrameStats } from "./frameAnalysis";

export type SceneType =
  | "portrait"
  | "group-portrait"
  | "landscape"
  | "food"
  | "product"
  | "architecture"
  | "indoor"
  | "outdoor"
  | "sunset"
  | "night"
  | "low-light"
  | "sports"
  | "document"
  | "macro"
  | "backlit";

export const SCENE_LABELS: Record<SceneType, string> = {
  portrait: "Portrait",
  "group-portrait": "Group portrait",
  landscape: "Landscape",
  food: "Food",
  product: "Product",
  architecture: "Architecture",
  indoor: "Indoor",
  outdoor: "Outdoor",
  sunset: "Sunset / sunrise",
  night: "Night",
  "low-light": "Low light",
  sports: "Moving subject",
  document: "Document",
  macro: "Close-up / macro",
  backlit: "Backlit",
};

export interface FaceBox {
  /** Normalized 0..1 in the analysis frame. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneInput {
  stats: FrameStats;
  /** null = face detection unavailable in this browser; [] = available but none found. */
  faces: FaceBox[] | null;
  /** 0..1 mean frame difference. */
  motion: number;
}

export interface SceneScore {
  scene: SceneType;
  score: number;
  reasons: string[];
}

export interface SceneResult {
  scene: SceneType;
  label: string;
  /** 0..1 — heuristic confidence, not a probability. */
  confidence: number;
  reasons: string[];
  /** Additional conditions that also apply (e.g. "backlit" alongside "portrait"). */
  flags: SceneType[];
  faceDetection: "available" | "unavailable";
  faceCount: number;
  lowLight: boolean;
}

export const LOW_LIGHT_LINEAR = 0.035;
export const NIGHT_LINEAR = 0.012;
export const MOTION_THRESHOLD = 0.06;

export const isLowLight = (s: FrameStats): boolean => s.meanLinear < LOW_LIGHT_LINEAR;
export const isNight = (s: FrameStats): boolean => s.meanLinear < NIGHT_LINEAR;

/** Subject is much darker than its surroundings and the surroundings are bright. */
export function isBacklit(s: FrameStats): boolean {
  return s.edgeLinear > 0.25 && s.centerLinear < s.edgeLinear * 0.45 && s.dynamicRange > 4;
}

/** Score every scene; higher = more likely. Exported for testing/inspection. */
export function scoreScenes(input: SceneInput): SceneScore[] {
  const { stats: s, faces, motion } = input;
  const scores: SceneScore[] = [];
  const add = (scene: SceneType, score: number, ...reasons: string[]) => {
    if (score > 0) scores.push({ scene, score: Math.min(1, score), reasons });
  };
  const hue = s.dominantHue;
  const warmHue = hue !== null && (hue <= 50 || hue >= 340);
  const faceCount = faces?.length ?? 0;
  const faceArea = faces ? faces.reduce((a, f) => a + f.width * f.height, 0) : 0;

  if (faceCount === 1) add("portrait", 0.6 + Math.min(0.35, faceArea * 6), "1 face detected");
  if (faceCount >= 2) add("group-portrait", 0.7 + Math.min(0.25, faceCount * 0.05), `${faceCount} faces detected`);

  if (motion > MOTION_THRESHOLD)
    add("sports", 0.45 + Math.min(0.45, (motion - MOTION_THRESHOLD) * 6), "Large frame-to-frame changes");

  if (isNight(s)) add("night", 0.85, "Very dark frame");
  else if (isLowLight(s)) add("low-light", 0.7, "Low average brightness");

  if (isBacklit(s)) add("backlit", 0.65, "Subject darker than bright surroundings");

  if (s.warmFraction > 0.25 && warmHue && s.topLinear > s.bottomLinear * 1.2 && s.meanLinear < 0.35 && !isNight(s)) {
    add("sunset", 0.5 + Math.min(0.4, s.warmFraction), "Warm saturated light, brighter sky");
  }

  if (s.paperFraction > 0.35 && s.meanSaturation < 0.15 && s.edgeDensity > 0.04) {
    add("document", 0.5 + Math.min(0.4, s.paperFraction - 0.35), "Mostly white, low colour, fine detail");
  }

  if (s.skyFraction > 0.3) add("landscape", 0.45 + Math.min(0.4, s.skyFraction * 0.6), "Blue sky in the upper frame");

  if (s.rectilinearity > 0.55 && s.edgeDensity > 0.05) {
    add("architecture", 0.35 + Math.min(0.4, (s.rectilinearity - 0.55) * 1.5), "Strong straight lines");
  }

  const centerSharpRatio = s.centerSharpness / Math.max(1, s.edgeSharpness);
  if (centerSharpRatio > 4 && s.centerSharpness > 150) {
    add("macro", 0.35 + Math.min(0.35, (centerSharpRatio - 4) * 0.05), "Sharp centre, blurred surroundings");
    if (warmHue && s.meanSaturation > 0.3)
      add("food", 0.5 + Math.min(0.3, s.meanSaturation - 0.3), "Warm, saturated close subject");
  }

  if (
    s.meanSaturation < 0.18 &&
    s.edgeLinear > 0.3 &&
    s.centerLinear < s.edgeLinear &&
    s.edgeSharpness < 40 &&
    s.centerSharpness > 60
  ) {
    add("product", 0.4, "Isolated subject on plain background");
  }

  // Fallbacks: indoor vs outdoor from brightness and illuminant colour.
  const cct = s.whiteBalance.cct;
  if (s.meanLinear > 0.2 && cct > 5000) add("outdoor", 0.3, "Bright, daylight-coloured light");
  else if (!isLowLight(s) && cct < 4800) add("indoor", 0.3, "Warm artificial-looking light");
  else if (!isLowLight(s)) add(s.meanLinear > 0.15 ? "outdoor" : "indoor", 0.2, "Brightness-based guess");

  return scores.sort((a, b) => b.score - a.score);
}

/** Pick the most likely scene plus flags that also apply. */
export function classifyScene(input: SceneInput): SceneResult {
  const scores = scoreScenes(input);
  const top = scores[0] ?? { scene: "outdoor" as SceneType, score: 0.1, reasons: ["No strong cues"] };
  const flagScenes: SceneType[] = ["backlit", "low-light", "night", "sports"];
  const flags = scores.filter((x) => x !== top && flagScenes.includes(x.scene) && x.score >= 0.45).map((x) => x.scene);
  return {
    scene: top.scene,
    label: SCENE_LABELS[top.scene],
    confidence: Math.round(top.score * 100) / 100,
    reasons: top.reasons,
    flags,
    faceDetection: input.faces === null ? "unavailable" : "available",
    faceCount: input.faces?.length ?? 0,
    lowLight: isLowLight(input.stats),
  };
}

/** Short unobtrusive status text for the viewfinder. */
export function sceneStatusText(r: SceneResult): string {
  if (r.scene === "portrait") return "Portrait detected";
  if (r.scene === "group-portrait") return `Group portrait — ${r.faceCount} faces`;
  if (r.scene === "night") return "Night scene detected";
  if (r.scene === "low-light") return "Low-light scene detected";
  if (r.scene === "backlit") return "Backlit scene detected";
  if (r.scene === "sports") return "Moving subject detected";
  return `${r.label} (estimated)`;
}
