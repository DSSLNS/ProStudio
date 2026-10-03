/**
 * AutoCameraEngine — analyses the live preview, recommends settings, applies
 * only what the device really supports (verified with getSettings()), captures,
 * and proposes non-destructive corrections for the captured image.
 *
 * Honesty rules enforced here:
 *  - Recommendations are never reported as "applied" unless applyConstraints()
 *    succeeded AND getSettings() reports the requested value.
 *  - ISO/shutter are only *applied* on devices with manual exposure support;
 *    otherwise they are recommendation-only (and null when current values are unknown).
 *  - Post-capture corrections are returned as an EditRecipe, never baked into pixels.
 */

import { defaultRecipe, type EditRecipe } from "@/types/edit";
import {
  pickSettings,
  supportsExposureCompensation,
  supportsISO,
  supportsManualExposure,
  supportsShutter,
  type CameraCapabilities,
  type CameraSettings,
} from "./capabilities";
import {
  calculateExposure,
  clamp,
  evOffsetFromLinear,
  evToCompensation,
  recommendIsoShutter,
  secondsToTrackUnits,
  snapToRange,
  trackUnitsToSeconds,
  type ExposureCalculation,
} from "./exposure";
import { analyzeFrame, lumaPlane, motionScore, regionLinear, type FrameStats } from "./frameAnalysis";
import {
  classifyScene,
  isBacklit,
  isLowLight,
  MOTION_THRESHOLD,
  type FaceBox,
  type SceneResult,
} from "./sceneDetection";
import { recommendWhiteBalance, type WbRecommendation } from "./whiteBalance";
import {
  captureHdr,
  captureNight,
  captureVideoFrame,
  createImageCapture,
  takePhoto,
  type CaptureResult,
  type FlashMode,
} from "./capture";

export const ANALYSIS_WIDTH = 160;

export interface LightingInfo {
  level: "bright" | "normal" | "low" | "night";
  backlit: boolean;
  /** Approximate illuminant colour temperature (gray-world estimate). */
  kelvin: number;
  dynamicRange: number;
}

export interface FocusRecommendation {
  /** focusMode string to request, or null if focus isn't controllable. */
  mode: string | null;
  reason: string;
}

export interface AppliedSettings {
  exposureMode?: string;
  exposureCompensation?: number;
  iso?: number;
  /** Track units (100 µs). */
  exposureTime?: number;
  whiteBalanceMode?: string;
  colorTemperature?: number;
  focusMode?: string;
  focusDistance?: number;
  zoom?: number;
  torch?: boolean;
}

export interface ApplyResult {
  /** Only settings confirmed by getSettings() after applyConstraints(). */
  applied: AppliedSettings;
  rejected: { key: keyof AppliedSettings; reason: string }[];
  settings: CameraSettings;
}

export interface RecommendedSettings {
  evCorrection: number;
  /** Value for the exposureCompensation constraint, or null when unsupported. */
  exposureCompensation: number | null;
  iso: number | null;
  shutterSeconds: number | null;
  /** True only when the device supports manual exposure AND we intend to apply ISO/shutter. */
  applyIsoShutter: boolean;
  isoShutterNote: string;
  whiteBalance: WbRecommendation;
  focus: FocusRecommendation;
  nightModeSuggested: boolean;
  hdrSuggested: boolean;
}

export interface AutoAnalysis {
  timestamp: number;
  stats: FrameStats;
  scene: SceneResult;
  brightness: { meanLuma: number; evOffset: number };
  motion: number;
  faces: FaceBox[] | null;
  lighting: LightingInfo;
  exposure: ExposureCalculation;
  recommendedExposure: number;
  recommendedWhiteBalance: number;
  recommendedISO: number | null;
  recommendedShutter: number | null;
  recommended: RecommendedSettings;
  applied: AppliedSettings;
}

export interface CaptureOptions {
  kind?: "single" | "night" | "hdr";
  flash?: FlashMode;
  nightFrames?: number;
  preferPng?: boolean;
  onProgress?: (fraction: number) => void;
}

export interface OptimizationResult {
  recipe: EditRecipe;
  /** Human-readable list, each labelled as a software correction. */
  corrections: string[];
}

type FaceDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
  detect(src: CanvasImageSource): Promise<{ boundingBox: DOMRectReadOnly }[]>;
};

export class AutoCameraEngine {
  private video: HTMLVideoElement | null = null;
  private track: MediaStreamTrack | null = null;
  private caps: CameraCapabilities | null = null;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private prevLuma: Uint8Array | null = null;
  private faceDetector: InstanceType<FaceDetectorCtor> | null = null;
  private faceDetectorFailed = false;
  private lastFaces: FaceBox[] | null = null;
  private lastApplied: AppliedSettings = {};
  private lastFrame: ImageData | null = null;
  private lastMotion = 0;

  attach(video: HTMLVideoElement | null, track: MediaStreamTrack | null, caps: CameraCapabilities | null): void {
    if (track !== this.track) {
      this.prevLuma = null;
      this.lastApplied = {};
    }
    this.video = video;
    this.track = track;
    this.caps = caps;
  }

  get faceDetectionAvailable(): boolean {
    return (
      typeof (globalThis as unknown as { FaceDetector?: unknown }).FaceDetector === "function" &&
      !this.faceDetectorFailed
    );
  }

  get latestFrame(): ImageData | null {
    return this.lastFrame;
  }

  get appliedSettings(): AppliedSettings {
    return this.lastApplied;
  }

  /** Draw the current video frame to the small analysis canvas and read it back. */
  grabAnalysisFrame(): ImageData | null {
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    const w = ANALYSIS_WIDTH;
    const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas =
        typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas");
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true }) as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    }
    if (!this.ctx) return null;
    this.ctx.drawImage(v, 0, 0, w, h);
    this.lastFrame = this.ctx.getImageData(0, 0, w, h);
    return this.lastFrame;
  }

  /** Exposure statistics for the current (or given) frame. */
  analyzeExposure(frame: ImageData | null = this.grabAnalysisFrame()): FrameStats | null {
    if (!frame) return null;
    return analyzeFrame(frame.data, frame.width, frame.height);
  }

  /** Real face detection via the Shape Detection API. Returns null when unavailable. */
  async detectFaces(): Promise<FaceBox[] | null> {
    if (!this.faceDetectionAvailable || !this.video?.videoWidth) return this.faceDetectionAvailable ? [] : null;
    try {
      if (!this.faceDetector) {
        const Ctor = (globalThis as unknown as { FaceDetector: FaceDetectorCtor }).FaceDetector;
        this.faceDetector = new Ctor({ fastMode: true, maxDetectedFaces: 10 });
      }
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      const found = await this.faceDetector.detect(this.video);
      this.lastFaces = found.map((f) => ({
        x: f.boundingBox.x / vw,
        y: f.boundingBox.y / vh,
        width: f.boundingBox.width / vw,
        height: f.boundingBox.height / vh,
      }));
      return this.lastFaces;
    } catch {
      // Some platforms expose the constructor but fail at runtime — treat as unavailable.
      this.faceDetectorFailed = true;
      this.lastFaces = null;
      return null;
    }
  }

  /** Motion 0..1 between the previous and current analysis frame. */
  detectMotion(frame: ImageData | null = this.lastFrame): number {
    if (!frame) return 0;
    const luma = lumaPlane(frame.data, frame.width, frame.height);
    const m = motionScore(this.prevLuma, luma);
    this.prevLuma = luma;
    // Light smoothing so a single noisy frame doesn't flip the scene.
    this.lastMotion = this.lastMotion * 0.5 + m * 0.5;
    return this.lastMotion;
  }

  detectLighting(stats: FrameStats): LightingInfo {
    const level =
      stats.meanLinear < 0.012 ? "night" : isLowLight(stats) ? "low" : stats.meanLinear > 0.3 ? "bright" : "normal";
    return { level, backlit: isBacklit(stats), kelvin: stats.whiteBalance.cct, dynamicRange: stats.dynamicRange };
  }

  calculateExposure(
    stats: FrameStats,
    faces: FaceBox[] | null,
    frame: ImageData | null = this.lastFrame,
  ): ExposureCalculation {
    let faceLinear: number | null = null;
    if (faces && faces.length > 0 && frame) {
      const vals = faces.map((f) => regionLinear(frame.data, frame.width, frame.height, f));
      faceLinear = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return calculateExposure({
      meteredLinear: stats.centerWeightedLinear,
      highlightClip: stats.highlightClip,
      shadowClip: stats.shadowClip,
      faceLinear,
      lowKey: stats.meanLinear < 0.012,
    });
  }

  calculateWhiteBalance(stats: FrameStats): WbRecommendation {
    const kelvinOk = !!this.caps && this.caps.whiteBalanceMode.includes("manual") && !!this.caps.colorTemperature;
    return recommendWhiteBalance(stats.whiteBalance, kelvinOk ? this.caps!.colorTemperature : null);
  }

  calculateFocus(motion: number): FocusRecommendation {
    const modes = this.caps?.focusMode ?? [];
    if (modes.includes("continuous")) {
      return {
        mode: "continuous",
        reason: motion > MOTION_THRESHOLD ? "Tracking a moving subject" : "Continuous autofocus",
      };
    }
    if (modes.includes("single-shot")) return { mode: "single-shot", reason: "Single autofocus before capture" };
    return { mode: null, reason: "Focus is not controllable from the browser on this camera" };
  }

  /** Full analysis of the current preview frame. */
  async analyzeScene(opts: { withFaces?: boolean } = {}): Promise<AutoAnalysis | null> {
    const frame = this.grabAnalysisFrame();
    const stats = this.analyzeExposure(frame);
    if (!stats || !frame) return null;
    const motion = this.detectMotion(frame);
    const faces = opts.withFaces
      ? await this.detectFaces()
      : this.faceDetectionAvailable
        ? (this.lastFaces ?? [])
        : null;
    const scene = classifyScene({ stats, faces, motion });
    const exposure = this.calculateExposure(stats, faces, frame);
    const recommended = this.recommendSettings({ stats, motion, exposure, scene });
    return {
      timestamp: Date.now(),
      stats,
      scene,
      brightness: { meanLuma: stats.meanLuma, evOffset: evOffsetFromLinear(stats.centerWeightedLinear) },
      motion,
      faces,
      lighting: this.detectLighting(stats),
      exposure,
      recommendedExposure: recommended.evCorrection,
      recommendedWhiteBalance: recommended.whiteBalance.estimatedKelvin,
      recommendedISO: recommended.iso,
      recommendedShutter: recommended.shutterSeconds,
      recommended,
      applied: this.lastApplied,
    };
  }

  recommendSettings(input: {
    stats: FrameStats;
    motion: number;
    exposure: ExposureCalculation;
    scene: SceneResult;
  }): RecommendedSettings {
    const caps = this.caps;
    const settings = this.currentSettings();
    const moving = input.motion > MOTION_THRESHOLD;
    let exposureCompensation: number | null = null;
    if (caps && supportsExposureCompensation(caps)) {
      const current = settings.exposureCompensation ?? 0;
      // Damped feedback: the frame already reflects the current compensation.
      exposureCompensation = evToCompensation(current + input.exposure.ev * 0.5, caps.exposureCompensation!);
    }
    let iso: number | null = null;
    let shutterSeconds: number | null = null;
    let applyIsoShutter = false;
    let isoShutterNote = "ISO and shutter are not reported by this camera — no recommendation possible.";
    if (caps && caps.iso && caps.exposureTime && settings.iso && settings.exposureTime) {
      const rec = recommendIsoShutter({
        evCorrection: input.exposure.ev,
        currentIso: settings.iso,
        currentExposureSeconds: trackUnitsToSeconds(settings.exposureTime),
        isoRange: caps.iso,
        exposureTimeRange: caps.exposureTime,
        moving,
      });
      if (rec) {
        iso = Math.round(rec.iso);
        shutterSeconds = rec.exposureSeconds;
        applyIsoShutter = supportsManualExposure(caps) && supportsISO(caps) && supportsShutter(caps) && moving;
        isoShutterNote = applyIsoShutter
          ? `${rec.reason} (applied to the camera)`
          : supportsManualExposure(caps)
            ? `${rec.reason} — recommendation only (camera stays in auto exposure)`
            : "Recommendation only — this camera does not allow manual ISO/shutter";
      }
    }
    return {
      evCorrection: input.exposure.ev,
      exposureCompensation,
      iso,
      shutterSeconds,
      applyIsoShutter,
      isoShutterNote,
      whiteBalance: this.calculateWhiteBalance(input.stats),
      focus: this.calculateFocus(input.motion),
      nightModeSuggested: input.scene.lowLight,
      hdrSuggested: input.stats.dynamicRange > 7 || input.stats.highlightClip > 0.03,
    };
  }

  currentSettings(): CameraSettings {
    return pickSettings(this.track?.getSettings() as Record<string, unknown> | undefined);
  }

  /**
   * Apply whatever the device supports and confirm it. Changes smaller than
   * 1/3 EV are skipped to avoid hunting. Returns only confirmed values.
   */
  async applySupportedSettings(rec: RecommendedSettings): Promise<ApplyResult> {
    const caps = this.caps;
    const track = this.track;
    const settings = this.currentSettings();
    if (!caps || !track || track.readyState !== "live") return { applied: {}, rejected: [], settings };
    const set: Record<string, unknown> = {};
    if (rec.focus.mode && settings.focusMode !== rec.focus.mode) set.focusMode = rec.focus.mode;
    if (rec.applyIsoShutter && rec.iso && rec.shutterSeconds && caps.iso && caps.exposureTime) {
      set.exposureMode = "manual";
      set.iso = snapToRange(rec.iso, caps.iso);
      set.exposureTime = snapToRange(secondsToTrackUnits(rec.shutterSeconds), caps.exposureTime);
    } else {
      if (caps.exposureMode.includes("continuous") && settings.exposureMode && settings.exposureMode !== "continuous") {
        set.exposureMode = "continuous";
      }
      if (
        rec.exposureCompensation !== null &&
        Math.abs(rec.exposureCompensation - (settings.exposureCompensation ?? 0)) >= 0.33
      ) {
        set.exposureCompensation = rec.exposureCompensation;
      }
    }
    if (Object.keys(set).length === 0) return { applied: this.lastApplied, rejected: [], settings };
    return this.applyAndVerify(set as AppliedSettings);
  }

  /** applyConstraints + getSettings verification for an arbitrary set of camera settings. */
  async applyAndVerify(set: AppliedSettings): Promise<ApplyResult> {
    const track = this.track;
    if (!track) return { applied: {}, rejected: [], settings: {} };

    // Always send the full accumulated desired state merged with the new values.
    // Some devices reset unmentioned constraints on each applyConstraints call;
    // re-sending the full state prevents ISO from disappearing when shutter changes.
    const merged = { ...this.lastApplied, ...set } as AppliedSettings;

    const rejected: ApplyResult["rejected"] = [];
    try {
      await track.applyConstraints({ advanced: [merged as MediaTrackConstraintSet] });
    } catch (e) {
      const reason = (e as Error)?.message || "The camera rejected the settings";
      for (const k of Object.keys(set) as (keyof AppliedSettings)[]) rejected.push({ key: k, reason });
      return { applied: this.lastApplied, rejected, settings: this.currentSettings() };
    }
    const settings = this.currentSettings();
    const confirmed = verifyApplied(merged, settings);
    for (const k of Object.keys(set) as (keyof AppliedSettings)[]) {
      if (!(k in confirmed)) rejected.push({ key: k, reason: "Not confirmed by the camera" });
    }
    this.lastApplied = confirmed;
    return { applied: this.lastApplied, rejected, settings };
  }

  /** Capture a still. Night/HDR are real multi-frame captures. */
  async capture(opts: CaptureOptions = {}): Promise<CaptureResult> {
    const video = this.video;
    const track = this.track;
    const caps = this.caps;
    if (!video || !track || !caps) throw new Error("The camera is not ready.");
    if (opts.kind === "night") return captureNight(video, opts.nightFrames ?? 8, opts.onProgress);
    if (opts.kind === "hdr") return captureHdr(track, video, caps, opts.onProgress);
    const ic = caps.photo ? createImageCapture(track) : null;
    if (ic) {
      try {
        return await takePhoto(ic, caps, { flash: opts.flash });
      } catch {
        // takePhoto can fail on some platforms (e.g. stream reconfiguration); fall back below.
      }
    }
    const res = await captureVideoFrame(video, opts.preferPng ? "image/png" : "image/jpeg");
    return ic ? { ...res, note: "Full-resolution photo failed; captured the video frame instead" } : res;
  }

  /**
   * Non-destructive corrections for a captured image, based on the analysis at
   * capture time and on what the hardware already did. Every change is a
   * software correction stored in the recipe; the original bytes are untouched.
   *
   * Scene-specific processing profiles ensure portraits, landscapes, night, and
   * food shots receive different treatment rather than one-size-fits-all adjustments.
   */
  optimizeCapturedImage(
    analysis: AutoAnalysis | null,
    opts: { hardwareExposureApplied?: boolean; hardwareWbApplied?: boolean } = {},
  ): OptimizationResult {
    const recipe = defaultRecipe();
    const corrections: string[] = [];
    if (!analysis) return { recipe, corrections };
    const { stats, exposure, recommended, scene } = analysis;

    // ── Exposure ─────────────────────────────────────────────────────────────
    if (!opts.hardwareExposureApplied && Math.abs(exposure.ev) >= 0.2) {
      recipe.light.exposure = Math.round(clamp(exposure.ev * 0.7, -1.5, 1.5) * 100) / 100;
      corrections.push(
        `Digital exposure ${recipe.light.exposure > 0 ? "+" : ""}${recipe.light.exposure.toFixed(2)} EV`,
      );
    }

    // ── Highlights / shadows ──────────────────────────────────────────────────
    if (stats.highlightClip > 0.01 || exposure.highlightProtected) {
      recipe.light.highlights = -Math.round(clamp(20 + stats.highlightClip * 400, 20, 50));
      corrections.push(`Highlights ${recipe.light.highlights}`);
    }
    if (analysis.lighting.backlit || stats.shadowClip > 0.08) {
      recipe.light.shadows = Math.round(clamp(20 + stats.shadowClip * 200, 20, 45));
      corrections.push(`Shadows +${recipe.light.shadows}`);
    }

    // ── White balance ─────────────────────────────────────────────────────────
    if (!opts.hardwareWbApplied && !recommended.whiteBalance.neutral) {
      recipe.color.temperature = recommended.whiteBalance.softwareTemperature;
      recipe.color.tint = recommended.whiteBalance.softwareTint;
      corrections.push(
        `White balance ${signed(recipe.color.temperature)} / tint ${signed(recipe.color.tint)}`,
      );
    }

    // ── Scene-specific processing profiles ───────────────────────────────────
    const sceneType = scene.scene;
    const isPortrait = sceneType === "portrait" || sceneType === "group-portrait";
    const isLowLightScene = sceneType === "night" || sceneType === "low-light" || analysis.lighting.level === "night" || analysis.lighting.level === "low";

    if (isPortrait) {
      // Portrait: natural skin, moderate contrast, controlled sharpening.
      recipe.light.contrast = 8;
      recipe.color.saturation = -5;          // slightly desaturated for natural skin
      recipe.color.vibrance = 10;            // lift dull tones without burning skin
      recipe.detail.sharpenAmount = 35;      // moderate — avoid plastic skin
      recipe.detail.sharpenRadius = 0.7;
      if (isLowLightScene) {
        recipe.detail.noiseLuminance = 40;
        recipe.detail.noiseColor = 50;
        corrections.push("Night portrait: noise reduction, natural skin tones");
      } else {
        recipe.detail.noiseLuminance = 15;
        corrections.push("Portrait: natural contrast, skin-aware sharpening");
      }
    } else if (sceneType === "landscape" || sceneType === "outdoor" || sceneType === "sunset") {
      // Landscape/outdoor: rich colour, punchy contrast, texture detail.
      recipe.light.contrast = 18;
      recipe.light.clarity = 20;
      recipe.color.saturation = 8;
      recipe.color.vibrance = 18;
      recipe.detail.sharpenAmount = 55;
      recipe.detail.sharpenRadius = 1.0;
      corrections.push("Landscape: enhanced colour and detail");
    } else if (isLowLightScene) {
      // Night: lift shadows, strong noise reduction, careful sharpening.
      recipe.light.contrast = 5;
      recipe.light.shadows = Math.max(recipe.light.shadows, 25);
      recipe.detail.noiseLuminance = 55;
      recipe.detail.noiseColor = 60;
      recipe.detail.sharpenAmount = 25;      // very gentle — noise amplifies harshly
      corrections.push("Night: shadow lift, noise reduction");
    } else if (sceneType === "food") {
      // Food: warm, vibrant, appetising.
      recipe.light.contrast = 12;
      recipe.light.clarity = 15;
      recipe.color.temperature += 8;
      recipe.color.vibrance = 22;
      recipe.color.saturation = 6;
      recipe.detail.sharpenAmount = 60;
      corrections.push("Food: warm colours, enhanced vibrance");
    } else if (sceneType === "document") {
      // Document: high contrast, maximum sharpness, desaturated.
      recipe.light.contrast = 25;
      recipe.color.saturation = -15;
      recipe.detail.sharpenAmount = 80;
      recipe.detail.sharpenRadius = 0.8;
      corrections.push("Document: high contrast and sharpness");
    } else if (sceneType === "macro") {
      // Macro: sharp, moderate contrast, natural colour.
      recipe.light.contrast = 14;
      recipe.detail.sharpenAmount = 70;
      recipe.detail.sharpenRadius = 0.8;
      corrections.push("Macro: sharpness and detail");
    } else if (sceneType === "backlit") {
      // Backlit: aggressive shadow lift, highlight protection.
      recipe.light.shadows = Math.max(recipe.light.shadows, 35);
      recipe.light.highlights = Math.min(recipe.light.highlights, -25);
      recipe.light.contrast = 5;
      corrections.push("Backlit: shadow lift, highlight protection");
    } else {
      // General: subtle improvements applicable to any scene.
      recipe.light.contrast = 10;
      recipe.color.vibrance = 8;
      recipe.detail.sharpenAmount = 45;
      recipe.detail.noiseLuminance = 12;
    }

    return { recipe, corrections };
  }

  dispose(): void {
    this.video = null;
    this.track = null;
    this.prevLuma = null;
    this.lastFrame = null;
    this.faceDetector = null;
  }
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Keep only requested settings that getSettings() actually reports (within tolerance). Pure. */
export function verifyApplied(requested: AppliedSettings, reported: CameraSettings): AppliedSettings {
  const out: AppliedSettings = {};
  for (const [k, v] of Object.entries(requested) as [keyof AppliedSettings, unknown][]) {
    const r = (reported as Record<string, unknown>)[k];
    if (typeof v === "number" && typeof r === "number") {
      if (Math.abs(r - v) <= Math.max(0.02, Math.abs(v) * 0.05)) (out as Record<string, unknown>)[k] = r;
    } else if (v === r && r !== undefined) {
      (out as Record<string, unknown>)[k] = r;
    }
  }
  return out;
}
