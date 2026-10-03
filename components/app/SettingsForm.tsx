"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUiStore, type UiPreferences } from "@/store/uiStore";
import { getBrowserCapabilities, type BrowserCapabilities } from "@/lib/browserCapabilities";
import { storageEstimate } from "@/storage/indexedDB";
import { formatBytes } from "@/lib/fileUtils";

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor} className="text-sm">
          {label}
        </Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-card px-4" aria-labelledby={`g-${title}`}>
      <h2 id={`g-${title}`} className="border-b border-border py-3 text-sm font-semibold">
        {title}
      </h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Toggle<K extends keyof UiPreferences>({ k, label, hint }: { k: K; label: string; hint?: string }) {
  const value = useUiStore((s) => s[k]) as boolean;
  const set = useUiStore((s) => s.set);
  return (
    <Row label={label} hint={hint} htmlFor={`pref-${k}`}>
      <Switch id={`pref-${k}`} checked={value} onCheckedChange={(v) => set(k, v as UiPreferences[K])} />
    </Row>
  );
}

function Choice<K extends keyof UiPreferences>({
  k,
  label,
  hint,
  options,
}: {
  k: K;
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
}) {
  const value = useUiStore((s) => s[k]) as string;
  const set = useUiStore((s) => s.set);
  return (
    <Row label={label} hint={hint}>
      <Select value={value} onValueChange={(v) => set(k, v as UiPreferences[K])}>
        <SelectTrigger className="w-48" aria-label={label}>
          <SelectValue>{options.find((o) => o.value === value)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

function Capabilities() {
  const [caps, setCaps] = useState<BrowserCapabilities | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void getBrowserCapabilities().then(setCaps);
    void storageEstimate().then(setUsage);
  }, []);
  if (!caps) return <p className="py-3 text-sm text-muted-foreground">Detecting…</p>;
  const rows: [string, boolean, string?][] = [
    ["Camera access (MediaDevices)", caps.mediaDevices, caps.secureContext ? undefined : "requires HTTPS"],
    ["ImageCapture (full-resolution photos)", caps.imageCapture],
    ["Face detection (Shape Detection API)", caps.faceDetector],
    ["WebGL2 (GPU processing)", caps.webgl2, caps.webgl2 ? `max texture ${caps.maxTextureSize}px` : undefined],
    ["Float render targets", caps.webgl2FloatRender],
    ["WebGPU", caps.webgpu, "detected; the current engine uses WebGL2"],
    ["WebAssembly", caps.wasm, caps.wasmSimd ? "with SIMD" : undefined],
    ["Web Workers + OffscreenCanvas", caps.workers && caps.offscreenCanvas],
    ["GPU export in worker", caps.offscreenWebgl2],
    ["IndexedDB (local projects)", caps.indexedDB],
    ["File System Access (Save As)", caps.fileSystemAccess],
    ["WebP encoding", caps.encode.webp],
    ["AVIF encoding", caps.encode.avif],
  ];
  return (
    <>
      <ul className="grid gap-1 py-3 text-sm">
        {rows.map(([label, ok, note]) => (
          <li key={label} className="flex items-center gap-2">
            {ok ? (
              <Check className="size-4 text-emerald-500" aria-label="Supported" />
            ) : (
              <X className="size-4 text-muted-foreground" aria-label="Not available" />
            )}
            <span>{label}</span>
            <span className="text-xs text-muted-foreground">
              {ok ? (note ?? "Supported") : "Not available on this device/browser"}
            </span>
          </li>
        ))}
      </ul>
      <p className="pb-3 text-xs text-muted-foreground">
        {caps.deviceMemoryGB ? `Device memory ≈ ${caps.deviceMemoryGB} GB · ` : ""}
        {caps.hardwareConcurrency} CPU threads
        {usage ? ` · Storage used ${formatBytes(usage.usage)} of ~${formatBytes(usage.quota)}` : ""}
      </p>
    </>
  );
}

export function SettingsForm() {
  const { theme, setTheme } = useTheme();
  const quality = useUiStore((s) => s.defaultJpegQuality);
  const set = useUiStore((s) => s.set);
  const reset = useUiStore((s) => s.reset);
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- theme is only known on the client
  useEffect(() => setMounted(true), []);

  return (
    <div>
      <Group title="Appearance">
        <Row label="Theme">
          <Select value={mounted ? (theme ?? "dark") : "dark"} onValueChange={(v) => setTheme(v as string)}>
            <SelectTrigger className="w-48" aria-label="Theme">
              <SelectValue>
                {{ dark: "Dark", light: "Light", system: "System" }[mounted ? (theme ?? "dark") : "dark"]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Toggle k="highContrast" label="High contrast" hint="Stronger borders and text contrast." />
        <Row label="Language" hint="Only English is available in this version.">
          <span className="text-sm text-muted-foreground">English</span>
        </Row>
      </Group>

      <Group title="Export">
        <Choice
          k="defaultExportFormat"
          label="Default format"
          options={[
            { value: "jpeg", label: "JPEG" },
            { value: "png", label: "PNG" },
            { value: "webp", label: "WebP" },
            { value: "avif", label: "AVIF" },
            { value: "tiff", label: "TIFF" },
          ]}
        />
        <Row label={`Default JPEG quality: ${quality}`} htmlFor="pref-quality">
          <Slider
            id="pref-quality"
            aria-label="Default JPEG quality"
            className="w-48"
            min={1}
            max={100}
            value={quality}
            onValueChange={(v) => set("defaultJpegQuality", Array.isArray(v) ? v[0] : (v as number))}
          />
        </Row>
        <Toggle
          k="preserveMetadata"
          label="Preserve metadata"
          hint="Copy EXIF (camera, lens, date) into JPEG/PNG exports."
        />
        <Toggle
          k="stripLocationOnExport"
          label="Remove location metadata on export"
          hint="Strips GPS coordinates — recommended for privacy."
        />
      </Group>

      <Group title="Editing">
        <Toggle k="autoSave" label="Auto-save" hint="Saves edit settings to this device shortly after each change." />
        <Choice
          k="performanceMode"
          label="Performance mode"
          hint="Controls preview resolution only. Export always uses the full-resolution original."
          options={[
            { value: "quality", label: "Quality (≤4096 px preview)" },
            { value: "balanced", label: "Balanced (≤2560 px)" },
            { value: "performance", label: "Performance (≤1600 px)" },
          ]}
        />
        <Toggle
          k="gpuAcceleration"
          label="GPU acceleration"
          hint="Use WebGL2 for previews and export. Turn off to force the CPU renderer."
        />
      </Group>

      <Group title="Camera">
        <Choice
          k="defaultCameraMode"
          label="Default camera mode"
          options={[
            { value: "auto", label: "Auto" },
            { value: "manual", label: "Manual" },
          ]}
        />
        <Choice
          k="preferredFacing"
          label="Preferred camera"
          options={[
            { value: "environment", label: "Back camera" },
            { value: "user", label: "Front camera" },
          ]}
        />
        <Toggle k="mirrorSelfie" label="Mirror selfies" />
        <Choice
          k="grid"
          label="Grid overlay"
          options={[
            { value: "none", label: "None" },
            { value: "thirds", label: "Rule of thirds" },
            { value: "golden", label: "Golden ratio" },
            { value: "center", label: "Center cross" },
            { value: "square", label: "Square" },
          ]}
        />
        <Toggle k="showHistogram" label="Show live histogram" />
        <Choice
          k="histogram"
          label="Histogram type"
          options={[
            { value: "luma", label: "Luminance" },
            { value: "rgb", label: "RGB" },
          ]}
        />
        <Toggle k="showLevel" label="Show level indicator" />
      </Group>

      <Group title="Privacy & AI">
        <Toggle
          k="localAiOnly"
          label="Local processing only"
          hint="Never upload images for processing. All current features run entirely on this device."
        />
        <Row label="Analytics" hint="ProStudio contains no analytics or tracking.">
          <span className="text-sm text-muted-foreground">None</span>
        </Row>
      </Group>

      <Group title="This device">
        <Capabilities />
      </Group>

      <Button
        variant="outline"
        onClick={() => {
          reset();
          toast.success("Settings restored to defaults");
        }}
      >
        Restore default settings
      </Button>
    </div>
  );
}
