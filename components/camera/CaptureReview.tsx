"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Pencil, RotateCcw, Check } from "lucide-react";
import { captureFileName, extensionFor } from "@/camera/capture";
import { Button } from "@/components/ui/button";
import { formatMegapixels, saveBlobAs } from "@/lib/fileUtils";
import { createProjectFromFile } from "@/storage/projects";
import { useCameraStore, type CapturedPhoto } from "@/store/cameraStore";
import { FramingMask } from "./FramingMask";

const METHOD_LABEL: Record<CapturedPhoto["method"], string> = {
  takePhoto: "Full-resolution photo",
  "video-frame": "Video frame (native stream resolution)",
  "night-multiframe": "Night (multi-frame)",
  "hdr-fusion": "HDR (exposure fusion)",
};

/** Review screen after capture: Retake / Save / Edit Photo. */
export function CaptureReview() {
  const photo = useCameraStore((s) => s.lastCapture);
  const setLastCapture = useCameraStore((s) => s.setLastCapture);
  const router = useRouter();
  const [busy, setBusy] = useState<null | "save" | "edit">(null);
  if (!photo) return null;

  const fileName = captureFileName(new Date(photo.capturedAt), extensionFor(photo.mimeType));

  const ensureProject = async (): Promise<string> => {
    if (photo.projectId) return photo.projectId;
    const project = await createProjectFromFile(photo.blob, {
      name: fileName.replace(/\.\w+$/, ""),
      origin: "camera",
      recipe: photo.recipe,
    });
    useCameraStore.setState((s) =>
      s.lastCapture === photo ? { lastCapture: { ...photo, projectId: project.id } } : {},
    );
    return project.id;
  };

  const onSave = async () => {
    setBusy("save");
    try {
      await ensureProject();
      const r = await saveBlobAs(photo.blob, fileName, "Photo");
      toast.success(r === "cancelled" ? "Saved to Projects." : "Saved to Projects and your device (original file).");
    } catch (e) {
      toast.error((e as Error)?.message || "Saving failed.");
    } finally {
      setBusy(null);
    }
  };

  const onEdit = async () => {
    setBusy("edit");
    try {
      const id = await ensureProject();
      router.push(`/editor?project=${encodeURIComponent(id)}`);
    } catch (e) {
      toast.error((e as Error)?.message || "Could not open the editor.");
      setBusy(null);
    }
  };

  const crop = photo.recipe.geometry.crop;
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Review photo"
      data-testid="capture-review"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <div
          className="relative max-h-full max-w-full"
          style={{ aspectRatio: `${photo.width} / ${photo.height}`, height: "100%" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL of the captured original */}
          <img
            src={photo.url}
            alt="Captured photo"
            className="size-full object-contain"
            style={photo.recipe.geometry.flipH ? { transform: "scaleX(-1)" } : undefined}
          />
          <FramingMask rect={crop} />
        </div>
      </div>
      <div className="flex flex-col gap-2 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <p className="text-center text-sm font-medium" data-testid="capture-dimensions">
          {formatMegapixels(photo.width, photo.height)}
        </p>
        <p className="text-center text-xs text-white/60">
          {METHOD_LABEL[photo.method]}
          {photo.note ? ` · ${photo.note}` : ""}
        </p>
        {photo.corrections.length > 0 && (
          <ul
            className="mx-auto max-w-md text-center text-[11px] text-white/60"
            aria-label="Non-destructive adjustments"
          >
            {photo.corrections.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="lg" onClick={() => setLastCapture(null)} disabled={!!busy} autoFocus>
            <RotateCcw /> Retake
          </Button>
          <Button variant="secondary" size="lg" onClick={onSave} disabled={!!busy}>
            {photo.projectId ? <Check /> : <Download />} {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            size="lg"
            onClick={onEdit}
            disabled={!!busy}
            className="bg-brand text-brand-foreground hover:bg-brand/85"
          >
            <Pencil /> {busy === "edit" ? "Opening…" : "Edit Photo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
