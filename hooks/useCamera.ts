"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { AutoCameraEngine, type AppliedSettings, type ApplyResult } from "@/camera/autoCamera";
import { normalizeCapabilities, pickSettings, type CameraCapabilities } from "@/camera/capabilities";
import { createImageCapture, getPhotoCapabilities } from "@/camera/capture";
import {
  describeCameraError,
  guessFacingFromLabel,
  listVideoDevices,
  openStream,
  queryCameraPermission,
  stopStream,
  watchCameraPermission,
  type Facing,
} from "@/camera/deviceManager";
import { focusPeakingMask, lumaPlane, shadowClipMask, zebraMask } from "@/camera/frameAnalysis";
import { pointConfirmed } from "@/camera/focus";
import { RESOLUTION_PRESETS, useCameraStore, type CameraMode, type ResolutionChoice } from "@/store/cameraStore";
import { runCapture } from "@/camera/capturePipeline";

const ANALYSIS_INTERVAL_MS = 110; // ~9 fps
const FACE_INTERVAL_MS = 500;
const AUTO_APPLY_INTERVAL_MS = 1500;

export interface CameraApi {
  /** Callback ref for the preview <video> element. */
  attachVideo: (el: HTMLVideoElement | null) => void;
  engine: AutoCameraEngine;
  start: () => Promise<void>;
  stop: () => void;
  switchCamera: () => Promise<void>;
  selectDevice: (deviceId: string) => Promise<void>;
  setResolution: (r: ResolutionChoice) => Promise<void>;
  applySettings: (set: AppliedSettings, label?: string) => Promise<ApplyResult | null>;
  focusAt: (point: { x: number; y: number }) => Promise<"confirmed" | "unconfirmed" | "unsupported">;
  capture: () => Promise<void>;
  cancelCountdown: () => void;
  isFront: boolean;
  mirrored: boolean;
}

function resolutionSize(r: ResolutionChoice): { width?: number; height?: number } {
  if (r === "max") return { width: 4096, height: 3072 }; // "ideal" — the browser picks the closest the camera supports
  const p = RESOLUTION_PRESETS.find((x) => x.id === r);
  return p ? { width: p.width, height: p.height } : {};
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/**
 * Camera lifecycle for a camera page. Requests the camera when the page mounts
 * (never elsewhere), stops all tracks on unmount and when the page is hidden,
 * and runs a throttled (~9 fps) analysis loop on a 160 px frame.
 */
export function useCamera(mode: CameraMode): CameraApi {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef(0);
  const engine = useMemo(() => new AutoCameraEngine(), []);
  const countdownCancel = useRef<(() => void) | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
    useCameraStore.getState().set("mode", mode);
  }, [mode]);

  const stop = useCallback(() => {
    sessionRef.current++;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    engine.attach(null, null, null);
    const s = useCameraStore.getState();
    if (s.status === "live" || s.status === "starting") s.set("status", "stopped");
  }, [engine]);

  const start = useCallback(async () => {
    const store = useCameraStore.getState();
    const session = ++sessionRef.current;
    stopStream(streamRef.current);
    streamRef.current = null;
    store.set("status", "starting");
    store.set("error", null);
    try {
      const size = resolutionSize(store.resolution);
      const { stream, downgraded } = await openStream({ deviceId: store.deviceId, facing: store.facing, ...size });
      if (session !== sessionRef.current) {
        stopStream(stream);
        return;
      }
      if (downgraded) toast.info("The requested resolution isn't supported — using a lower one.");
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch(() => undefined);
      }
      const rawCaps = (typeof track.getCapabilities === "function" ? track.getCapabilities() : {}) as Record<
        string,
        unknown
      >;
      const rawSettings = track.getSettings() as Record<string, unknown>;
      const ic = createImageCapture(track);
      const photoCaps = await withTimeout(getPhotoCapabilities(ic), 2000, null);
      if (session !== sessionRef.current) return;
      const caps: CameraCapabilities = normalizeCapabilities(rawCaps, rawSettings, photoCaps);
      const settings = pickSettings(rawSettings);
      engine.attach(video, track, caps);
      const devices = await listVideoDevices();
      const current = devices.find((d) => d.deviceId === settings.deviceId);
      const facing: Facing =
        (settings.facingMode === "user" || settings.facingMode === "environment" ? settings.facingMode : null) ??
        (current ? guessFacingFromLabel(current.label) : null) ??
        store.facing;
      useCameraStore.setState({
        status: "live",
        capabilities: caps,
        settings,
        devices,
        deviceId: settings.deviceId ?? store.deviceId,
        facing,
        imageCaptureAvailable: !!ic && !!photoCaps,
        streamSize: settings.width && settings.height ? { width: settings.width, height: settings.height } : null,
        applied: {},
        analysis: null,
        masks: null,
        permission: "granted",
        captureKind: "single",
      });
      // Auto mode starts from the camera's own continuous algorithms where they are controllable.
      if (modeRef.current === "auto") {
        const reset: AppliedSettings = {};
        if (caps.exposureMode.includes("continuous")) reset.exposureMode = "continuous";
        if (caps.whiteBalanceMode.includes("continuous")) reset.whiteBalanceMode = "continuous";
        if (caps.focusMode.includes("continuous")) reset.focusMode = "continuous";
        if (Object.keys(reset).length) {
          const res = await engine.applyAndVerify(reset);
          useCameraStore.setState({ applied: res.applied, settings: res.settings });
        }
      }
    } catch (e) {
      if (session !== sessionRef.current) return;
      const info = describeCameraError(e);
      useCameraStore.setState({
        status: "error",
        error: info,
        permission: info.code === "denied" ? "denied" : useCameraStore.getState().permission,
      });
    }
  }, [engine]);

  // Mount: load preferences, start the camera. Unmount: stop every track.
  useEffect(() => {
    useCameraStore.getState().initFromPreferences();
    void start();
    let unwatch: (() => void) | null = null;
    void queryCameraPermission().then((p) => {
      if (p !== "unknown") useCameraStore.getState().set("permission", p);
    });
    void watchCameraPermission((p) => useCameraStore.getState().set("permission", p)).then((u) => (unwatch = u));
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else if (!streamRef.current) void start();
    };
    const onDeviceChange = () => void listVideoDevices().then((d) => useCameraStore.getState().set("devices", d));
    document.addEventListener("visibilitychange", onVisibility);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      unwatch?.();
      countdownCancel.current?.();
      stop();
      engine.dispose();
    };
  }, [start, stop, engine]);

  // Analysis loop (throttled rAF).
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let lastFaces = 0;
    let lastApply = 0;
    let busy = false;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (busy || t - last < ANALYSIS_INTERVAL_MS) return;
      const s = useCameraStore.getState();
      if (s.status !== "live" || s.capturing) return;
      last = t;
      busy = true;
      const withFaces = t - lastFaces > FACE_INTERVAL_MS;
      if (withFaces) lastFaces = t;
      engine
        .analyzeScene({ withFaces })
        .then(async (analysis) => {
          if (!analysis) return;
          const st = useCameraStore.getState();
          const frame = engine.latestFrame;
          const o = st.overlays;
          let masks = null;
          if (frame && (o.zebra || o.clipping || o.focusPeaking)) {
            masks = {
              width: frame.width,
              height: frame.height,
              zebra:
                o.zebra || o.clipping ? zebraMask(frame.data, frame.width, frame.height, o.zebra ? 242 : 252) : null,
              shadows: o.clipping ? shadowClipMask(frame.data, frame.width, frame.height) : null,
              peaking: o.focusPeaking
                ? focusPeakingMask(lumaPlane(frame.data, frame.width, frame.height), frame.width, frame.height)
                : null,
            };
          }
          useCameraStore.setState({ analysis, masks, settings: engine.currentSettings() });
          if (modeRef.current === "auto" && t - lastApply > AUTO_APPLY_INTERVAL_MS) {
            lastApply = t;
            const res = await engine.applySupportedSettings(analysis.recommended);
            useCameraStore.setState({ applied: res.applied, settings: res.settings });
          }
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const switchCamera = useCallback(async () => {
    const s = useCameraStore.getState();
    const reportedFacing = s.settings.facingMode;
    if (reportedFacing === "user" || reportedFacing === "environment" || s.devices.length <= 1) {
      // Facing-capable (mobile) cameras: toggle facingMode and let the browser pick the device.
      s.set("facing", s.facing === "user" ? "environment" : "user");
      s.set("deviceId", null);
    } else {
      const idx = s.devices.findIndex((d) => d.deviceId === s.deviceId);
      const next = s.devices[(idx + 1) % s.devices.length];
      s.set("deviceId", next.deviceId);
    }
    s.set("digitalZoom", 1);
    await start();
  }, [start]);

  const selectDevice = useCallback(
    async (deviceId: string) => {
      useCameraStore.getState().set("deviceId", deviceId);
      await start();
    },
    [start],
  );

  const setResolution = useCallback(
    async (r: ResolutionChoice) => {
      useCameraStore.getState().set("resolution", r);
      await start();
    },
    [start],
  );

  const applySettings = useCallback(
    async (set: AppliedSettings, label?: string) => {
      if (useCameraStore.getState().status !== "live") return null;
      const res = await engine.applyAndVerify(set);
      useCameraStore.setState({ applied: res.applied, settings: res.settings });
      if (res.rejected.length) {
        toast.warning(`${label ?? res.rejected.map((r) => r.key).join(", ")}: the camera did not apply this setting.`);
      }
      return res;
    },
    [engine],
  );

  const focusAt = useCallback(async (point: { x: number; y: number }) => {
    const s = useCameraStore.getState();
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !s.capabilities?.pointsOfInterest) return "unsupported" as const;
    const set: Record<string, unknown> = { pointsOfInterest: [point] };
    const modes = s.capabilities.focusMode;
    if (modes.includes("single-shot")) set.focusMode = "single-shot";
    else if (modes.includes("continuous")) set.focusMode = "continuous";
    try {
      await track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] });
    } catch {
      return "unconfirmed" as const;
    }
    const settings = pickSettings(track.getSettings() as Record<string, unknown>);
    useCameraStore.setState({ settings });
    return pointConfirmed(point, settings.pointsOfInterest) ? ("confirmed" as const) : ("unconfirmed" as const);
  }, []);

  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      const stream = streamRef.current;
      if (el && stream && el.srcObject !== stream) {
        el.srcObject = stream;
        el.muted = true;
        void el.play().catch(() => undefined);
        const s = useCameraStore.getState();
        engine.attach(el, stream.getVideoTracks()[0] ?? null, s.capabilities);
      }
    },
    [engine],
  );

  const cancelCountdown = useCallback(() => {
    countdownCancel.current?.();
    countdownCancel.current = null;
  }, []);

  const capture = useCallback(async () => {
    const s = useCameraStore.getState();
    if (s.capturing || s.countdown !== null || s.status !== "live") return;
    await runCapture({
      engine,
      registerCancel: (fn) => (countdownCancel.current = fn),
      isFront: isFrontCamera(),
    });
  }, [engine]);

  const facingSetting = useCameraStore((st) => st.settings.facingMode);
  const facing = useCameraStore((st) => st.facing);
  const mirrorSelfie = useCameraStore((st) => st.mirrorSelfie);
  const isFront = facingSetting ? facingSetting === "user" : facing === "user";

  return {
    attachVideo,
    engine,
    start,
    stop,
    switchCamera,
    selectDevice,
    setResolution,
    applySettings,
    focusAt,
    capture,
    cancelCountdown,
    isFront,
    mirrored: isFront && mirrorSelfie,
  };
}

export function isFrontCamera(): boolean {
  const s = useCameraStore.getState();
  return s.settings.facingMode ? s.settings.facingMode === "user" : s.facing === "user";
}
