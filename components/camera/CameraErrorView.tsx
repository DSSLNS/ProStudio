"use client";

import Link from "next/link";
import { CameraOff } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "./CameraContext";

/** Shown over the viewfinder when the camera could not start. */
export function CameraErrorView() {
  const api = useCameraApi();
  const error = useCameraStore((s) => s.error);
  if (!error) return null;
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/85 p-6 text-center text-white"
      role="alert"
      data-testid="camera-error"
    >
      <CameraOff className="size-10 text-white/70" aria-hidden />
      <p className="max-w-sm text-base">{error.message}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {error.retryable && <Button onClick={() => void api.start()}>Try again</Button>}
        <Link href="/camera" className={buttonVariants({ variant: "outline" })}>
          Back
        </Link>
      </div>
    </div>
  );
}
