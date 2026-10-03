"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Cpu, Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Section } from "../controls/AdjustmentSlider";
import { LiveSlider } from "../controls/LiveSlider";
import { useEditorStore } from "@/store/editorStore";
import { useToolStore } from "@/store/toolStore";
import { cancelAi, isModelInstalled, MODELS, modelSize, type ModelId } from "@/engine/ai/aiClient";
import { formatBytes } from "@/lib/fileUtils";
import { orientedSize } from "@/engine/image/transform";
import {
  adjustSky,
  adjustSubject,
  aiDenoise,
  aiUpscale,
  portraitEnhance,
  removeBackground,
  removeObject,
  selectSky,
  selectSubject,
  UPSCALE_LIMIT_EDGE,
  UPSCALE_LIMIT_PX,
} from "./aiActions";

function useInstalled(): Record<ModelId, boolean | null> {
  const [state, setState] = useState<Record<ModelId, boolean | null>>(() =>
    Object.fromEntries(Object.keys(MODELS).map((k) => [k, null])) as Record<ModelId, boolean | null>,
  );
  useEffect(() => {
    for (const id of Object.keys(MODELS) as ModelId[]) void isModelInstalled(id).then((ok) => setState((s) => ({ ...s, [id]: ok })));
  }, []);
  return state;
}

function ModelBadge({ id, installed }: { id: ModelId; installed: boolean | null }) {
  const m = MODELS[id];
  return (
    <p className="mb-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
      {installed ? <Check className="mt-px size-3 shrink-0 text-emerald-500" aria-hidden /> : <X className="mt-px size-3 shrink-0" aria-hidden />}
      <span>
        {m.name} · {formatBytes(modelSize(id))} · {m.license}
        {installed === false && " — not installed on this server (run `npm run models`)."}
        {installed && " — runs locally; downloaded once, then cached for offline use."}
      </span>
    </p>
  );
}

export function AiPanel() {
  const installed = useInstalled();
  const router = useRouter();
  const project = useEditorStore((s) => s.project);
  const geometry = useEditorStore((s) => s.recipe.geometry);
  const hasSelection = useEditorStore((s) => !!s.selection);
  const setTool = useEditorStore((s) => s.setTool);
  const selectionMode = useToolStore((s) => s.selectionMode);
  const [busy, setBusy] = useState<{ label: string; fraction: number; message: string } | null>(null);
  const [refine, setRefine] = useState(4);
  const [denoise, setDenoise] = useState(80);
  const [pending, setPending] = useState<{ apply: () => void; cancel: () => void } | null>(null);

  const run = async <T,>(label: string, fn: (p: (f: number, m: string) => void) => Promise<T>): Promise<T | undefined> => {
    setBusy({ label, fraction: 0, message: "Starting…" });
    try {
      return await fn((fraction, message) => setBusy({ label, fraction, message }));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== "Cancelled") toast.error(`${label}: ${msg}`);
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  const done = (label: string, backend?: string) => backend && toast.success(`${label} — processed locally (${backend}).`);

  const out = project ? orientedSize(project.width, project.height, geometry) : { width: 0, height: 0 };
  const cw = Math.round(out.width * (geometry.crop?.width ?? 1));
  const ch = Math.round(out.height * (geometry.crop?.height ?? 1));
  const upscaleOk = (f: number) => cw * f * ch * f <= UPSCALE_LIMIT_PX && Math.max(cw, ch) * f <= UPSCALE_LIMIT_EDGE;
  const disabled = !!busy || !!pending;

  return (
    <div>
      <div className="flex items-start gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground">
        <Cpu className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>All AI runs on this device (WebGPU when available, otherwise WebAssembly). Images are never uploaded. Models load only when you use a feature.</p>
      </div>

      {busy && (
        <div className="grid gap-1.5 border-b border-border px-4 py-3" role="status" aria-live="polite" data-testid="ai-progress">
          <p className="flex items-center gap-2 text-xs font-medium">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> {busy.label}
          </p>
          <Progress value={Math.round(busy.fraction * 100)} />
          <p className="text-[11px] text-muted-foreground">{busy.message}</p>
          <Button size="xs" variant="ghost" className="justify-self-start" onClick={cancelAi}>
            Cancel
          </Button>
        </div>
      )}

      <Section title="Subject & background">
        <ModelBadge id="u2netp" installed={installed.u2netp} />
        <LiveSlider label="Edge refinement" min={0} max={12} value={refine} onLive={setRefine} format={(v) => (v ? `${Math.round(v)}` : "Off")} />
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" disabled={!installed.u2netp || disabled} onClick={() => void run("Select subject", (p) => selectSubject(selectionMode, refine, p)).then((b) => done("Subject selected", b))} data-testid="ai-select-subject">
            Select subject
          </Button>
          <Button size="sm" variant="outline" disabled={!installed.u2netp || disabled} onClick={() => void run("Remove background", (p) => removeBackground(refine, p)).then((b) => done("Background removed (as a mask)", b))} data-testid="ai-remove-bg">
            Remove background
          </Button>
          <Button size="sm" variant="outline" disabled={!installed.u2netp || disabled} onClick={() => void run("Adjust subject", (p) => adjustSubject(false, refine, p)).then((b) => done("Subject adjustment layer added", b))}>
            Adjust subject
          </Button>
          <Button size="sm" variant="outline" disabled={!installed.u2netp || disabled} onClick={() => void run("Adjust background", (p) => adjustSubject(true, refine, p)).then((b) => done("Background adjustment layer added", b))}>
            Adjust background
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Finds the main (salient) subject. It does not classify it as a person, animal or vehicle. Results are editable masks; the photo is never altered.
        </p>
      </Section>

      <Section title="Sky">
        <ModelBadge id="skyseg" installed={installed.skyseg} />
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" disabled={!installed.skyseg || disabled} onClick={() => void run("Adjust sky", (p) => adjustSky(refine, p)).then((b) => done("Sky adjustment layer added", b))} data-testid="ai-adjust-sky">
            Adjust sky
          </Button>
          <Button size="sm" variant="outline" disabled={!installed.skyseg || disabled} onClick={() => void run("Select sky", (p) => selectSky(selectionMode, refine, p)).then((b) => done("Sky selected", b))}>
            Select sky
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Creates a masked layer for sky exposure, temperature, saturation, highlights and contrast.</p>
      </Section>

      <Section title="Object removal">
        <ModelBadge id="migan" installed={installed.migan} />
        {pending ? (
          <div className="grid gap-2">
            <p className="text-xs">Preview shown. Keep the result?</p>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => (pending.apply(), setPending(null))} data-testid="ai-apply">
                Apply
              </Button>
              <Button size="sm" variant="outline" onClick={() => (pending.cancel(), setPending(null))} data-testid="ai-cancel">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setTool("select-brush")} disabled={disabled}>
              Paint over the object
            </Button>
            <Button
              size="sm"
              disabled={!installed.migan || disabled || !hasSelection}
              onClick={() =>
                void run("Object removal", (p) => removeObject(p)).then((r) => {
                  if (r) setPending(r);
                })
              }
              data-testid="ai-remove-object"
            >
              Remove painted object
            </Button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Fills the area with plausible content generated by the model, as a new masked layer — the original stays intact.</p>
      </Section>

      <Section title="AI denoise">
        <ModelBadge id="scunet" installed={installed.scunet} />
        <LiveSlider label="Intensity" min={0} max={100} value={denoise} onLive={setDenoise} format={(v) => `${Math.round(v)}%`} />
        <Button size="sm" variant="outline" className="mt-1 w-full" disabled={!installed.scunet || disabled} onClick={() => void run("AI denoise", (p) => aiDenoise(denoise, p)).then((b) => done("Denoised layer added (adjust its opacity to taste)", b))} data-testid="ai-denoise">
          Denoise at full resolution
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Adds a denoised copy of the developed photo as a layer; intensity is its opacity. Re-run after large tone edits. Large images take a while without WebGPU.
        </p>
      </Section>

      <Section title="AI upscale">
        <ModelBadge id="esrgan" installed={installed.esrgan} />
        <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">
          AI upscaling generates estimated detail; it cannot recover information that was never captured.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {([2, 4] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant="outline"
              disabled={!installed.esrgan || disabled || !upscaleOk(f)}
              title={upscaleOk(f) ? undefined : `Result would exceed ${UPSCALE_LIMIT_PX / 1e6} MP`}
              onClick={() =>
                void run(`AI upscale ${f}×`, (p) => aiUpscale(f, p)).then((id) => {
                  if (id)
                    toast.success(`Upscaled copy saved as a new project (${cw * f} × ${ch * f}).`, {
                      action: { label: "Open", onClick: () => router.push(`/editor?project=${id}`) },
                    });
                })
              }
              data-testid={`ai-upscale-${f}`}
            >
              {f}× → {cw * f} × {ch * f}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Creates a new project; this one is unchanged.</p>
      </Section>

      <Section title="Portrait enhancement">
        <ModelBadge id="u2netp" installed={installed.u2netp} />
        <Button size="sm" variant="outline" className="w-full" disabled={!installed.u2netp || disabled} onClick={() => void run("Portrait enhancement", (p) => portraitEnhance(refine, p)).then((b) => done("Portrait layers added", b))} data-testid="ai-portrait">
          Enhance skin & tone
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Adds texture-preserving skin smoothing and a tone layer, masked to skin on the subject. Faces are never reshaped and identity is not changed. Adjust or delete the layers freely.
        </p>
      </Section>

      <p className="px-4 py-3 text-[11px] text-muted-foreground">
        <Download className="mr-1 inline size-3" aria-hidden />
        Models: {Object.values(installed).filter(Boolean).length} of {Object.keys(MODELS).length} installed.
      </p>
    </div>
  );
}
