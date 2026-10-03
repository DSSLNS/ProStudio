"use client";

import Link from "next/link";
import { ArrowLeft, Flashlight, Moon, RefreshCw, Settings2, Timer, Zap, ZapOff, Layers, Crop } from "lucide-react";
import { supportsBracketing, supportsFlash } from "@/camera/capabilities";
import { ASPECT_RATIOS, type FlashMode } from "@/camera/capture";
import { useCameraStore, type TimerSeconds } from "@/store/cameraStore";
import { useCameraApi } from "./CameraContext";
import { ToolbarButton } from "./ToolbarButton";

const TIMERS: TimerSeconds[] = [0, 3, 10];
const FLASH_LABEL: Record<FlashMode, string> = { off: "Off", auto: "Auto", flash: "On" };

/** Top bar: back, camera switch, flash/torch (only when reported), HDR (only if bracketing is real), night, timer, aspect, settings. */
export function CameraToolbar({ onOpenSettings, settingsOpen }: { onOpenSettings: () => void; settingsOpen: boolean }) {
  const api = useCameraApi();
  const caps = useCameraStore((s) => s.capabilities);
  const devices = useCameraStore((s) => s.devices);
  const flash = useCameraStore((s) => s.flash);
  const torch = useCameraStore((s) => s.settings.torch ?? false);
  const kind = useCameraStore((s) => s.captureKind);
  const lowLight = useCameraStore((s) => s.analysis?.scene.lowLight ?? false);
  const timer = useCameraStore((s) => s.timer);
  const aspect = useCameraStore((s) => s.aspect);
  const set = useCameraStore((s) => s.set);
  const live = useCameraStore((s) => s.status === "live");

  const flashModes: FlashMode[] = caps?.photo
    ? (["off", "auto", "flash"] as FlashMode[]).filter((m) => m === "off" || caps.photo!.fillLightMode.includes(m))
    : [];
  const canSwitch = devices.length > 1;

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-2 py-1" role="toolbar" aria-label="Camera options">
      <Link
        href="/camera"
        aria-label="Back to camera mode selection"
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full text-white outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <ArrowLeft className="size-5" />
      </Link>
      <div className="ml-auto flex items-center gap-1">
        {caps && supportsFlash(caps) && (
          <ToolbarButton
            aria-label={`Flash: ${FLASH_LABEL[flash]}. Click to change`}
            onClick={() => set("flash", flashModes[(flashModes.indexOf(flash) + 1) % flashModes.length])}
          >
            {flash === "off" ? <ZapOff className="size-5" /> : <Zap className="size-5" />}
            <span>{FLASH_LABEL[flash]}</span>
          </ToolbarButton>
        )}
        {caps?.torch && (
          <ToolbarButton
            active={torch}
            aria-label={torch ? "Turn torch off" : "Turn torch on"}
            onClick={() => void api.applySettings({ torch: !torch }, "Torch")}
          >
            <Flashlight className="size-5" />
          </ToolbarButton>
        )}
        {caps && supportsBracketing(caps) && (
          <ToolbarButton
            active={kind === "hdr"}
            aria-label={
              kind === "hdr"
                ? "HDR on (3-frame exposure bracketing). Turn off"
                : "Turn on HDR (3-frame exposure bracketing)"
            }
            onClick={() => set("captureKind", kind === "hdr" ? "single" : "hdr")}
          >
            <Layers className="size-5" />
            <span>HDR</span>
          </ToolbarButton>
        )}
        {(lowLight || kind === "night") && (
          <ToolbarButton
            active={kind === "night"}
            aria-label={
              kind === "night" ? "Night (multi-frame) on. Turn off" : "Low light detected: turn on Night (multi-frame)"
            }
            onClick={() => set("captureKind", kind === "night" ? "single" : "night")}
          >
            <Moon className="size-5" />
            <span>Night</span>
          </ToolbarButton>
        )}
        <ToolbarButton
          active={timer > 0}
          aria-label={`Self-timer: ${timer ? `${timer} seconds` : "off"}. Click to change`}
          onClick={() => set("timer", TIMERS[(TIMERS.indexOf(timer) + 1) % TIMERS.length])}
        >
          <Timer className="size-5" />
          <span>{timer ? `${timer}s` : "Off"}</span>
        </ToolbarButton>
        <ToolbarButton
          active={aspect !== "full"}
          aria-label={`Aspect ratio: ${aspect === "full" ? "full sensor" : aspect}. Click to change`}
          onClick={() => set("aspect", ASPECT_RATIOS[(ASPECT_RATIOS.indexOf(aspect) + 1) % ASPECT_RATIOS.length])}
        >
          <Crop className="size-5" />
          <span>{aspect === "full" ? "Full" : aspect}</span>
        </ToolbarButton>
        {canSwitch && (
          <ToolbarButton aria-label="Switch camera" disabled={!live} onClick={() => void api.switchCamera()}>
            <RefreshCw className="size-5" />
          </ToolbarButton>
        )}
        <ToolbarButton
          active={settingsOpen}
          aria-label="Camera settings"
          aria-expanded={settingsOpen}
          aria-controls="camera-settings"
          onClick={onOpenSettings}
        >
          <Settings2 className="size-5" />
        </ToolbarButton>
      </div>
    </div>
  );
}
