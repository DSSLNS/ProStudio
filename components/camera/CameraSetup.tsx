"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Aperture, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  describeCameraError,
  hasDeviceLabels,
  isCameraApiAvailable,
  listVideoDevices,
  queryCameraPermission,
  requestCameraPermission,
  type PermissionStateExt,
} from "@/camera/deviceManager";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RESOLUTION_PRESETS, useCameraStore, type ResolutionChoice } from "@/store/cameraStore";
import { NativeSelect } from "./NativeSelect";

const PERMISSION_TEXT: Record<PermissionStateExt, string> = {
  granted: "Camera access granted",
  denied: "Camera access denied — enable it in your browser's site settings",
  prompt: "The browser will ask for camera access when you start",
  unknown: "Permission status not reported by this browser",
};

function ModeCard({ href, title, text, icon }: { href: string; title: string; text: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-6 transition-colors outline-none hover:border-brand/60 focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`mode-${title.split(" ")[0].toLowerCase()}`}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-brand/15 text-brand">{icon}</span>
      <span className="text-xl font-semibold tracking-wide">{title}</span>
      <span className="text-sm text-muted-foreground">{text}</span>
    </Link>
  );
}

/** Mode choice + camera/device/resolution preferences. Never requests camera access by itself. */
export function CameraSetup() {
  const facing = useCameraStore((s) => s.facing);
  const deviceId = useCameraStore((s) => s.deviceId);
  const devices = useCameraStore((s) => s.devices);
  const resolution = useCameraStore((s) => s.resolution);
  const permission = useCameraStore((s) => s.permission);
  const set = useCameraStore((s) => s.set);
  const [requesting, setRequesting] = useState(false);
  const [env, setEnv] = useState<{ api: boolean; secure: boolean } | null>(null);

  useEffect(() => {
    useCameraStore.getState().initFromPreferences();
    let alive = true;
    // enumerateDevices / permissions.query never trigger a permission prompt.
    void Promise.all([listVideoDevices(), queryCameraPermission()]).then(([d, p]) => {
      if (!alive) return;
      useCameraStore.setState({ devices: d, permission: p });
      setEnv({ api: isCameraApiAvailable(), secure: window.isSecureContext });
    });
    return () => {
      alive = false;
    };
  }, []);

  const grant = async () => {
    setRequesting(true);
    try {
      const d = await requestCameraPermission();
      useCameraStore.setState({ devices: d, permission: "granted" });
    } catch (e) {
      const info = describeCameraError(e);
      toast.error(info.message);
      if (info.code === "denied") set("permission", "denied");
    } finally {
      setRequesting(false);
    }
  };

  const labelled = hasDeviceLabels(devices);

  return (
    <div className="mt-6 flex flex-col gap-8">
      {env && (!env.api || !env.secure) && (
        <p
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          role="alert"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {!env.secure
            ? "Camera access requires a secure connection (HTTPS or localhost)."
            : "This browser does not support camera access."}
        </p>
      )}

      <section aria-label="Camera modes" className="grid gap-4 sm:grid-cols-2">
        <ModeCard
          href="/camera/auto"
          title="AUTO MODE"
          text="Let ProStudio automatically optimize the camera settings for the scene."
          icon={<Sparkles className="size-6" aria-hidden />}
        />
        <ModeCard
          href="/camera/manual"
          title="MANUAL MODE"
          text="Control your camera like a professional photographer."
          icon={<Aperture className="size-6" aria-hidden />}
        />
      </section>

      <section aria-labelledby="cam-choice" className="flex flex-col gap-3">
        <h2 id="cam-choice" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Camera
        </h2>
        <div role="radiogroup" aria-label="Camera facing" className="flex gap-2">
          {(["environment", "user"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={facing === f && !deviceId}
              onClick={() => useCameraStore.setState({ facing: f, deviceId: null })}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                facing === f && !deviceId ? "border-brand bg-brand/15" : "border-border hover:bg-muted",
              )}
            >
              {f === "environment" ? "Back camera" : "Front camera"}
            </button>
          ))}
        </div>

        {devices.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {devices.length} camera{devices.length === 1 ? "" : "s"} available
            </p>
            {labelled ? (
              <ul className="flex flex-col gap-1.5" aria-label="Available cameras">
                {devices.map((d, i) => (
                  <li key={d.deviceId || i}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-checked:border-brand">
                      <input
                        type="radio"
                        name="camera-device"
                        checked={deviceId === d.deviceId}
                        onChange={() => set("deviceId", d.deviceId)}
                        className="accent-[var(--brand)]"
                      />
                      {d.label || `Camera ${i + 1}`}
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>Grant camera access to see device names.</span>
                <Button variant="outline" onClick={grant} disabled={requesting || permission === "denied"}>
                  {requesting ? "Requesting…" : "Grant camera access"}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="cam-res" className="flex flex-col gap-2">
        <h2 id="cam-res" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Resolution
        </h2>
        <NativeSelect
          aria-label="Preview stream resolution"
          className="w-fit border-border bg-background text-foreground"
          value={resolution}
          onChange={(e) => set("resolution", e.target.value as ResolutionChoice)}
        >
          <option value="max">Highest available</option>
          {RESOLUTION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          The camera uses the closest size it supports; the actual resolution is shown in camera settings. Where the
          browser supports it, photos are taken at the camera&apos;s full photo resolution.
        </p>
      </section>

      <section aria-labelledby="cam-perm" className="flex flex-col gap-1">
        <h2 id="cam-perm" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Permission
        </h2>
        <p className="text-sm" data-testid="camera-permission">
          {PERMISSION_TEXT[permission]}
        </p>
        <p className="text-xs text-muted-foreground">Photos never leave this device.</p>
      </section>
    </div>
  );
}
