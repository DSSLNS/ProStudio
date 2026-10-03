"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type OrientationPermission = () => Promise<"granted" | "denied">;

const noopSubscribe = () => () => {};
/** iOS 13+ gates orientation events behind a permission that must be requested from a user gesture. */
const needsOrientationPermission = () =>
  typeof DeviceOrientationEvent !== "undefined" &&
  navigator.maxTouchPoints > 0 && // desktop browsers may expose the method but have no sensor
  typeof (DeviceOrientationEvent as unknown as { requestPermission?: OrientationPermission }).requestPermission ===
    "function";

function screenAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation) return screen.orientation.angle;
  return 0;
}

/**
 * Horizon level from DeviceOrientationEvent. iOS requires
 * DeviceOrientationEvent.requestPermission() from a user gesture, so we show a
 * button there. Hidden entirely when the device provides no orientation data.
 */
export function LevelIndicator() {
  const [roll, setRoll] = useState<number | null>(null);
  const gated = useSyncExternalStore(noopSubscribe, needsOrientationPermission, () => false);
  const [enabled, setEnabled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const needsPermission = gated && !dismissed;

  useEffect(() => {
    if (typeof DeviceOrientationEvent === "undefined") return;
    if (gated && !enabled) return;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      const a = screenAngle();
      // Roll relative to the screen's current orientation.
      const r = a === 90 ? -e.beta : a === 270 || a === -90 ? e.beta : a === 180 ? -e.gamma : e.gamma;
      setRoll(r);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [enabled, gated]);

  if (needsPermission && !enabled) {
    return (
      <button
        type="button"
        className="pointer-events-auto absolute right-2 bottom-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white focus-visible:ring-2 focus-visible:ring-brand outline-none"
        onClick={async () => {
          const req = (DeviceOrientationEvent as unknown as { requestPermission: OrientationPermission })
            .requestPermission;
          try {
            if ((await req()) === "granted") setEnabled(true);
            else setDismissed(true);
          } catch {
            setDismissed(true);
          }
        }}
      >
        Enable level
      </button>
    );
  }
  if (roll === null) return null;
  const level = Math.abs(roll) < 1;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      role="img"
      aria-label={level ? "Camera is level" : `Tilted ${roll.toFixed(0)} degrees`}
    >
      <div className="relative w-1/3" style={{ transform: `rotate(${-roll}deg)` }}>
        <div className={`h-0.5 w-full ${level ? "bg-emerald-300" : "bg-white/80"}`} />
      </div>
      <span className="absolute top-[calc(50%+10px)] rounded bg-black/50 px-1.5 text-[10px] text-white">
        {level ? "Level" : `${roll > 0 ? "+" : ""}${roll.toFixed(0)}°`}
      </span>
    </div>
  );
}
