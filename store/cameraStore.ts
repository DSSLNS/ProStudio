"use client";

import { create } from "zustand";
import type { CameraCapabilities, CameraSettings } from "@/camera/capabilities";
import type { CameraErrorInfo, Facing, PermissionStateExt, VideoDevice } from "@/camera/deviceManager";
import type { AutoAnalysis, AppliedSettings } from "@/camera/autoCamera";
import type { AspectRatioChoice, CaptureMethod, FlashMode } from "@/camera/capture";
import type { FocusChoice } from "@/camera/focus";
import type { EditRecipe } from "@/types/edit";
import type { GridType } from "@/store/uiStore";
import { useUiStore } from "@/store/uiStore";

export type StreamStatus = "idle" | "starting" | "live" | "stopped" | "error";
export type CameraMode = "auto" | "manual";
export type HistogramOverlay = "off" | "luma" | "rgb";
export type TimerSeconds = 0 | 3 | 10;
export type BurstCount = 1 | 3 | 5 | 10;
export type CaptureKind = "single" | "night" | "hdr";

/** Stream resolution choice; "max" requests the highest the camera reports. */
export type ResolutionChoice = "max" | "2160" | "1080" | "720" | "480";

export const RESOLUTION_PRESETS: { id: ResolutionChoice; label: string; width: number; height: number }[] = [
  { id: "2160", label: "4K (3840 × 2160)", width: 3840, height: 2160 },
  { id: "1080", label: "1080p (1920 × 1080)", width: 1920, height: 1080 },
  { id: "720", label: "720p (1280 × 720)", width: 1280, height: 720 },
  { id: "480", label: "480p (640 × 480)", width: 640, height: 480 },
];

export interface Overlays {
  grid: GridType;
  histogram: HistogramOverlay;
  exposureMeter: boolean;
  zebra: boolean;
  clipping: boolean;
  focusPeaking: boolean;
  level: boolean;
  centerMarker: boolean;
}

export interface OverlayMasks {
  width: number;
  height: number;
  zebra: Uint8Array | null;
  shadows: Uint8Array | null;
  peaking: Uint8Array | null;
}

/** Manual-mode intent. `null` numeric values mean "Auto". */
export interface ManualSettings {
  iso: number | null;
  /** Seconds. */
  shutter: number | null;
  ev: number;
  wb: { kind: "auto" } | { kind: "kelvin"; kelvin: number } | { kind: "software"; presetKelvin: number; label: string };
  focus: FocusChoice;
  focusDistance: number | null;
  zoom: number | null;
}

export interface CapturedPhoto {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  method: CaptureMethod;
  note?: string;
  /** Non-destructive recipe (aspect crop, selfie mirror, software corrections). */
  recipe: EditRecipe;
  corrections: string[];
  capturedAt: number;
  /** Set once the photo is stored as a project. */
  projectId?: string;
}

interface CameraState {
  status: StreamStatus;
  error: CameraErrorInfo | null;
  permission: PermissionStateExt;
  devices: VideoDevice[];
  deviceId: string | null;
  facing: Facing;
  resolution: ResolutionChoice;
  capabilities: CameraCapabilities | null;
  settings: CameraSettings;
  streamSize: { width: number; height: number } | null;
  imageCaptureAvailable: boolean;
  mode: CameraMode;
  overlays: Overlays;
  timer: TimerSeconds;
  burst: BurstCount;
  aspect: AspectRatioChoice;
  flash: FlashMode;
  captureKind: CaptureKind;
  digitalZoom: number;
  mirrorSelfie: boolean;
  manual: ManualSettings;
  analysis: AutoAnalysis | null;
  applied: AppliedSettings;
  masks: OverlayMasks | null;
  countdown: number | null;
  capturing: boolean;
  captureProgress: number | null;
  lastCapture: CapturedPhoto | null;
  prefsLoaded: boolean;

  set: <K extends keyof CameraState>(key: K, value: CameraState[K]) => void;
  setOverlay: <K extends keyof Overlays>(key: K, value: Overlays[K]) => void;
  setManual: (patch: Partial<ManualSettings>) => void;
  setLastCapture: (photo: CapturedPhoto | null) => void;
  initFromPreferences: () => void;
}

export const DEFAULT_MANUAL: ManualSettings = {
  iso: null,
  shutter: null,
  ev: 0,
  wb: { kind: "auto" },
  focus: "continuous",
  focusDistance: null,
  zoom: null,
};

export const useCameraStore = create<CameraState>()((set, get) => ({
  status: "idle",
  error: null,
  permission: "unknown",
  devices: [],
  deviceId: null,
  facing: "environment",
  resolution: "max",
  capabilities: null,
  settings: {},
  streamSize: null,
  imageCaptureAvailable: false,
  mode: "auto",
  overlays: {
    grid: "thirds",
    histogram: "luma",
    exposureMeter: true,
    zebra: false,
    clipping: false,
    focusPeaking: false,
    level: true,
    centerMarker: false,
  },
  timer: 0,
  burst: 1,
  aspect: "full",
  flash: "off",
  captureKind: "single",
  digitalZoom: 1,
  mirrorSelfie: true,
  manual: DEFAULT_MANUAL,
  analysis: null,
  applied: {},
  masks: null,
  countdown: null,
  capturing: false,
  captureProgress: null,
  lastCapture: null,
  prefsLoaded: false,

  set: (key, value) => set({ [key]: value } as Pick<CameraState, typeof key>),
  setOverlay: (key, value) => set((s) => ({ overlays: { ...s.overlays, [key]: value } })),
  setManual: (patch) => set((s) => ({ manual: { ...s.manual, ...patch } })),
  setLastCapture: (photo) => {
    const prev = get().lastCapture;
    if (prev && prev.url !== photo?.url) URL.revokeObjectURL(prev.url);
    set({ lastCapture: photo });
  },
  /** Load persisted preferences once per session (later calls are no-ops so user changes survive navigation). */
  initFromPreferences: () => {
    if (get().prefsLoaded) return;
    const p = useUiStore.getState();
    set((s) => ({
      prefsLoaded: true,
      facing: p.preferredFacing,
      mirrorSelfie: p.mirrorSelfie,
      overlays: {
        ...s.overlays,
        grid: p.grid,
        histogram: p.showHistogram ? p.histogram : "off",
        level: p.showLevel,
      },
    }));
  },
}));
