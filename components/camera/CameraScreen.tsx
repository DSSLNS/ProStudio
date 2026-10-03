"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useCamera } from "@/hooks/useCamera";
import type { CameraMode } from "@/store/cameraStore";
import { CameraBottomBar } from "./CameraBottomBar";
import { CameraProvider } from "./CameraContext";
import { CameraErrorView } from "./CameraErrorView";
import { CameraHud } from "./CameraHud";
import { CameraPreview } from "./CameraPreview";
import { CameraSettingsPanel } from "./CameraSettingsPanel";
import { CameraToolbar } from "./CameraToolbar";
import { CaptureReview } from "./CaptureReview";
import { SlideUpPanel } from "./SlideUpPanel";

/** Full-screen camera shell shared by Auto and Manual modes. */
export function CameraScreen({
  mode,
  panelTitle,
  panelLabel,
  panel,
}: {
  mode: CameraMode;
  panelTitle: string;
  panelLabel: string;
  panel: ReactNode;
}) {
  const api = useCamera(mode);
  const [open, setOpen] = useState<null | "settings" | "panel">(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <CameraProvider api={api}>
      <main
        id="main"
        className="relative flex h-dvh flex-col overflow-hidden bg-black pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-white"
        data-testid={`camera-${mode}`}
      >
        <h1 className="sr-only">{mode === "auto" ? "Auto camera" : "Manual camera"}</h1>
        <CameraToolbar
          settingsOpen={open === "settings"}
          onOpenSettings={() => setOpen(open === "settings" ? null : "settings")}
        />
        <div className="relative flex min-h-0 flex-1">
          <CameraPreview />
          <CameraHud showScene={mode === "auto"} />
          <CameraErrorView />
        </div>
        <CameraBottomBar
          mode={mode}
          panelLabel={panelLabel}
          panelOpen={open === "panel"}
          onTogglePanel={() => setOpen(open === "panel" ? null : "panel")}
        />
        <SlideUpPanel id="camera-settings" title="Camera settings" open={open === "settings"} onClose={close}>
          {open === "settings" && <CameraSettingsPanel />}
        </SlideUpPanel>
        <SlideUpPanel id="camera-panel" title={panelTitle} open={open === "panel"} onClose={close}>
          {open === "panel" && panel}
        </SlideUpPanel>
        <CaptureReview />
      </main>
    </CameraProvider>
  );
}
