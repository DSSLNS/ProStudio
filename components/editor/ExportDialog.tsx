"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Link2, Link2Off } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditorStore } from "@/store/editorStore";
import { useUiStore } from "@/store/uiStore";
import { outputSize } from "@/engine/image/transform";
import { FORMAT_INFO, type EncodeFormat } from "@/engine/export/encoders";
import { exportImage } from "@/engine/export/exportClient";
import { getBrowserCapabilities, type BrowserCapabilities } from "@/lib/browserCapabilities";
import { baseName, formatBytes, saveBlobAs } from "@/lib/fileUtils";
import { getDB } from "@/storage/indexedDB";
import { isWideGamutProfile } from "@/engine/color/icc";

const FORMATS: EncodeFormat[] = ["jpeg", "png", "webp", "avif", "tiff"];

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const project = useEditorStore((s) => s.project);
  const geometry = useEditorStore((s) => s.recipe.geometry);
  const prefs = useUiStore();
  const [caps, setCaps] = useState<BrowserCapabilities | null>(null);
  const [format, setFormat] = useState<EncodeFormat>(prefs.defaultExportFormat);
  const [quality, setQuality] = useState(prefs.defaultJpegQuality);
  const [resize, setResize] = useState(false);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [lockAspect, setLockAspect] = useState(true);
  const [metaMode, setMetaMode] = useState<"all" | "no-location" | "none">(
    !prefs.preserveMetadata ? "none" : prefs.stripLocationOnExport ? "no-location" : "all",
  );
  const [embedIcc, setEmbedIcc] = useState(true);
  const [transparency, setTransparency] = useState(true);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<{ f: number; msg: string } | null>(null);

  const full = project ? outputSize(project.width, project.height, geometry) : { width: 0, height: 0 };

  useEffect(() => {
    if (!open || !project) return;
    void getBrowserCapabilities().then(setCaps);
    /* eslint-disable react-hooks/set-state-in-effect -- reset form when the dialog opens */
    setWidth(full.width);
    setHeight(full.height);
    setResize(false);
    setName(baseName(project.name));
    setProgress(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, project, full.width, full.height]);

  const supported = (f: EncodeFormat) => (f === "webp" ? caps?.encode.webp : f === "avif" ? caps?.encode.avif : true);
  const info = FORMAT_INFO[format];
  const outW = resize ? width : full.width;
  const outH = resize ? height : full.height;
  const metadataApplies = project?.sourceType === "image/jpeg" || project?.sourceName.match(/\.jpe?g$/i);
  const wideGamut = isWideGamutProfile(project?.metadata?.colorSpace);

  const setW = (w: number) => {
    setWidth(w);
    if (lockAspect && full.width) setHeight(Math.max(1, Math.round((w * full.height) / full.width)));
  };
  const setH = (h: number) => {
    setHeight(h);
    if (lockAspect && full.height) setWidth(Math.max(1, Math.round((h * full.width) / full.height)));
  };

  const run = async () => {
    const s = useEditorStore.getState();
    if (!s.project || !s.source || !s.sourceFormat) return;
    if (outW < 1 || outH < 1 || outW > 65535 || outH > 65535) return toast.error("Please enter a valid size.");
    setProgress({ f: 0, msg: "Preparing" });
    try {
      let lut = null;
      if (s.recipe.lut) {
        const rec = await (await getDB()).get("luts", s.recipe.lut.id);
        if (rec)
          lut = { id: rec.id, size: rec.size, data: rec.data, domainMin: rec.domainMin, domainMax: rec.domainMax };
      }
      const result = await exportImage(
        {
          original: s.source,
          originalFormat: s.sourceFormat,
          recipe: s.recipe,
          layers: s.layers,
          lut,
          format,
          quality,
          width: resize ? outW : null,
          height: resize ? outH : null,
          transparency: info.alpha && transparency,
          background: "#ffffff",
          preserveMetadata: metaMode !== "none",
          stripGps: metaMode !== "all",
          metadataSummary: metaMode === "none" ? null : s.project.metadata,
          embedIcc,
          gpuAcceleration: prefs.gpuAcceleration,
        },
        (f, msg) => setProgress({ f, msg }),
      );
      const filename = `${(name || "photo").replace(/[\\/:*?"<>|]+/g, "_")}.${info.ext}`;
      const saved = await saveBlobAs(result.blob, filename, info.label);
      if (saved !== "cancelled") {
        toast.success(
          `Exported ${result.width} × ${result.height} ${info.label.split(" ")[0]} · ${formatBytes(result.blob.size)}`,
          {
            description: `${result.usedGpu ? "Rendered on GPU" : "Rendered on CPU"} from the full-resolution original${result.metadataWritten ? " · metadata included" : " · no metadata"}${result.iccEmbedded ? " · sRGB profile embedded" : ""}.`,
          },
        );
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !progress && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            Rendered from your original at full resolution ({full.width} × {full.height}). No watermark, no compression
            beyond what you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="export-name">File name</Label>
              <Input id="export-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Select value={format} onValueChange={(v) => setFormat(v as EncodeFormat)}>
              <SelectTrigger className="w-44" aria-label="Format" data-testid="export-format">
                <SelectValue>{FORMAT_INFO[format].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => (
                  <SelectItem key={f} value={f} disabled={!supported(f)}>
                    {FORMAT_INFO[f].label}
                    {!supported(f) && " — not supported by this browser"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {info.lossy ? (
            <div className="grid gap-2">
              <div className="flex justify-between text-sm">
                <Label htmlFor="export-quality">Quality</Label>
                <span className="font-mono text-xs">{quality}</span>
              </div>
              <Slider
                id="export-quality"
                aria-label="Quality"
                min={1}
                max={100}
                value={quality}
                onValueChange={(v) => setQuality(Array.isArray(v) ? v[0] : (v as number))}
              />
              <p className="text-xs text-muted-foreground">
                {info.label} is a lossy format; higher quality means larger files. Choose PNG or TIFF for lossless
                output.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {info.label}: lossless — every pixel of the render is preserved.
            </p>
          )}

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Switch id="export-resize" checked={resize} onCheckedChange={setResize} />
              <Label htmlFor="export-resize">Resize</Label>
              {!resize && (
                <span className="text-xs text-muted-foreground">
                  Keeping original size: {full.width} × {full.height}
                </span>
              )}
            </div>
            {resize && (
              <div className="flex items-end gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="export-w" className="text-xs">
                    Width
                  </Label>
                  <Input
                    id="export-w"
                    type="number"
                    min={1}
                    value={width}
                    onChange={(e) => setW(parseInt(e.target.value, 10) || 0)}
                    className="w-28"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={lockAspect ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  aria-pressed={lockAspect}
                  onClick={() => setLockAspect(!lockAspect)}
                >
                  {lockAspect ? <Link2 /> : <Link2Off />}
                </Button>
                <div className="grid gap-1">
                  <Label htmlFor="export-h" className="text-xs">
                    Height
                  </Label>
                  <Input
                    id="export-h"
                    type="number"
                    min={1}
                    value={height}
                    onChange={(e) => setH(parseInt(e.target.value, 10) || 0)}
                    className="w-28"
                  />
                </div>
                <span className="pb-2 text-xs text-muted-foreground">px</span>
              </div>
            )}
            {resize && (outW > full.width || outH > full.height) && (
              <p className="text-xs text-amber-500">Enlarging interpolates pixels; it cannot add real detail.</p>
            )}
          </div>

          <fieldset className="grid gap-1.5" disabled={format !== "jpeg" && format !== "png"}>
            <legend className="mb-1 text-sm">Metadata</legend>
            {(
              [
                ["all", "Keep all metadata (camera, lens, settings, date, location)"],
                ["no-location", "Keep metadata, remove location"],
                ["none", "Remove all metadata"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="export-metadata"
                  value={value}
                  checked={metaMode === value}
                  onChange={() => setMetaMode(value)}
                  data-testid={`meta-${value}`}
                />
                {label}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              {format === "jpeg" || format === "png"
                ? metadataApplies
                  ? "EXIF is copied from the original JPEG (orientation reset, embedded thumbnail removed)."
                  : project?.metadata
                    ? "Camera metadata read from the original is written as fresh EXIF."
                    : "The original has no readable camera metadata."
                : `Metadata embedding is not available for ${info.label.split(" ")[0]}; the file will contain no metadata.`}
              {project?.metadata?.hasGps && metaMode === "all" ? " ⚠ This photo contains GPS location, which will be included." : ""}
            </p>
          </fieldset>

          <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
              <Switch id="export-icc" checked={embedIcc} onCheckedChange={setEmbedIcc} disabled={format !== "jpeg" && format !== "png"} />
              <Label htmlFor="export-icc">Embed sRGB colour profile</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Pixels are exported in sRGB{format === "jpeg" || format === "png" ? "; the profile tags them correctly for colour-managed apps" : ""}.
              {wideGamut && " ⚠ The original uses a wide-gamut profile (" + project?.metadata?.colorSpace + "); colours outside sRGB are clipped."}
            </p>
          </div>

          {info.alpha && (
            <div className="flex items-center gap-2">
              <Switch id="export-alpha" checked={transparency} onCheckedChange={setTransparency} />
              <Label htmlFor="export-alpha">Keep transparency</Label>
            </div>
          )}

          {progress && (
            <div className="grid gap-1" role="status" aria-live="polite">
              <Progress value={Math.round(progress.f * 100)} />
              <p className="text-xs text-muted-foreground">Processing image… {progress.msg}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!progress}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!!progress || !supported(format)} data-testid="export-confirm">
            <Download aria-hidden /> Export {outW} × {outH}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
