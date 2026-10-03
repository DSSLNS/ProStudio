"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useEditorStore } from "@/store/editorStore";
import { analyseForAutoEdit, applySubjectExposure, type AutoEditProposal, type PixelBuffer } from "@/engine/analysis/autoEdit";
import { Switch } from "@/components/ui/switch";

function pixelsOf(
  bitmap: ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): PixelBuffer {
  const c = document.createElement("canvas");
  c.width = dw;
  c.height = dh;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
  return { data: ctx.getImageData(0, 0, dw, dh).data, width: dw, height: dh };
}

function analyse(bitmap: ImageBitmap): AutoEditProposal {
  const s = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const overview = pixelsOf(
    bitmap,
    0,
    0,
    bitmap.width,
    bitmap.height,
    Math.max(1, Math.round(bitmap.width * s)),
    Math.max(1, Math.round(bitmap.height * s)),
  );
  const cw = Math.min(512, bitmap.width);
  const ch = Math.min(512, bitmap.height);
  const detail = pixelsOf(bitmap, (bitmap.width - cw) / 2, (bitmap.height - ch) / 2, cw, ch, cw, ch);
  return analyseForAutoEdit(overview, detail);
}

export function AutoEditDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const preview = useEditorStore((s) => s.preview);
  const applyRecipe = useEditorStore((s) => s.applyRecipe);
  const [proposal, setProposal] = useState<AutoEditProposal | null>(null);
  const [intensity, setIntensity] = useState(100);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [baseProposal, setBaseProposal] = useState<AutoEditProposal | null>(null);

  useEffect(() => {
    if (open) void import("@/engine/ai/aiClient").then((m) => m.isModelInstalled("u2netp")).then(setAiAvailable);
  }, [open]);

  const toggleAi = async (on: boolean) => {
    setUseAi(on);
    if (!baseProposal) return;
    if (!on) return setProposal(baseProposal);
    setAiBusy(true);
    try {
      const { subjectLuma } = await import("./ai/aiActions");
      const stats = await subjectLuma();
      setProposal(stats ? applySubjectExposure(baseProposal, stats.subjectMedian, stats.coverage) : { ...baseProposal, notes: ["AI subject detection found no clear subject; using the whole-image analysis.", ...baseProposal.notes] });
    } catch (e) {
      setProposal({ ...baseProposal, notes: [`AI analysis unavailable: ${(e as Error).message}`, ...baseProposal.notes] });
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !preview) return;
    const p = analyse(preview.bitmap);
    /* eslint-disable react-hooks/set-state-in-effect -- analysis runs when the dialog opens */
    setProposal(p);
    setBaseProposal(p);
    setUseAi(false);
    setIntensity(100);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, preview]);

  const scaled = (v: number, key: string) =>
    key === "exposure" ? Math.round(v * intensity) / 100 : Math.round((v * intensity) / 100);

  const apply = () => {
    if (!proposal) return;
    applyRecipe("Auto Edit", (r) => {
      for (const c of proposal.changes) {
        const section = r[c.section] as unknown as Record<string, number>;
        section[c.key] = scaled(c.value, c.key);
      }
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Auto Edit result</DialogTitle>
          <DialogDescription>
            Proposed from an analysis of exposure, clipping, contrast, colour cast, saturation, skin tones and noise.
            Review before applying — nothing changes until you click Apply.
          </DialogDescription>
        </DialogHeader>
        {proposal ? (
          <div className="grid gap-3">
            <ul
              className="grid gap-1 rounded-md border border-border p-3 font-mono text-sm"
              data-testid="auto-edit-changes"
            >
              {proposal.changes.map((c) => {
                const v = scaled(c.value, c.key);
                return (
                  <li key={c.key} className="flex justify-between">
                    <span className="font-sans">{c.label}</span>
                    <span>
                      {v > 0 ? "+" : ""}
                      {c.key === "exposure" ? v.toFixed(2) : v}
                      {c.unit ? ` ${c.unit}` : ""}
                    </span>
                  </li>
                );
              })}
              {!proposal.changes.length && <li className="font-sans text-muted-foreground">No changes proposed.</li>}
            </ul>
            {proposal.notes.map((n) => (
              <p key={n} className="text-xs text-muted-foreground">
                {n}
              </p>
            ))}
            {aiAvailable && (
              <div className="flex items-center gap-2">
                <Switch id="auto-ai" checked={useAi} disabled={aiBusy} onCheckedChange={(v) => void toggleAi(v)} />
                <label htmlFor="auto-ai" className="text-xs">
                  {aiBusy ? "Running AI subject detection…" : "Use AI subject detection (local)"}
                </label>
              </div>
            )}
            <div className="grid gap-2">
              <div className="flex justify-between text-xs">
                <label htmlFor="auto-intensity">Intensity</label>
                <span className="font-mono">{intensity}%</span>
              </div>
              <Slider
                id="auto-intensity"
                aria-label="Auto Edit intensity"
                min={0}
                max={150}
                value={intensity}
                onValueChange={(v) => setIntensity(Array.isArray(v) ? v[0] : (v as number))}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Analysing…</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!proposal?.changes.length} data-testid="auto-edit-apply">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
