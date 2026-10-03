"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { Section, AdjustmentSlider } from "./controls/AdjustmentSlider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditorStore } from "@/store/editorStore";
import { getDB, newId, type LutRecord } from "@/storage/indexedDB";
import { parseCubeLut } from "@/engine/color/lut";

const MAX_CUBE_BYTES = 64 * 1024 * 1024;

export function LutSection() {
  const lut = useEditorStore((s) => s.recipe.lut);
  const applyRecipe = useEditorStore((s) => s.applyRecipe);
  const [luts, setLuts] = useState<Pick<LutRecord, "id" | "name" | "size">[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const all = await (await getDB()).getAll("luts");
    setLuts(all.map(({ id, name, size }) => ({ id, name, size })));
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load stored LUT list
    void refresh();
  }, []);

  const importCube = async (file: File) => {
    if (file.size > MAX_CUBE_BYTES) return toast.error("This LUT file is too large.");
    try {
      const cube = parseCubeLut(await file.text());
      const rec: LutRecord = {
        id: newId(),
        name: cube.title || file.name.replace(/\.cube$/i, ""),
        size: cube.size,
        data: cube.data,
        domainMin: cube.domainMin,
        domainMax: cube.domainMax,
        createdAt: Date.now(),
      };
      await (await getDB()).put("luts", rec);
      await refresh();
      applyRecipe("Apply LUT", (r) => {
        r.lut = { id: rec.id, name: rec.name, intensity: 100 };
      });
      toast.success(`LUT “${rec.name}” imported (${cube.size}³)`);
    } catch (e) {
      toast.error(`Could not import LUT: ${(e as Error).message}`);
    }
  };

  return (
    <Section title="LUT (.cube)">
      <div className="flex gap-2">
        <Select
          value={lut?.id ?? ""}
          onValueChange={(id) => {
            const l = luts.find((x) => x.id === id);
            if (l)
              applyRecipe(
                "Apply LUT",
                (r) => void (r.lut = { id: l.id, name: l.name, intensity: r.lut?.intensity ?? 100 }),
              );
          }}
        >
          <SelectTrigger className="min-w-0 flex-1" aria-label="Choose LUT">
            <SelectValue placeholder={luts.length ? "Choose a LUT" : "No LUTs imported"}>{lut?.name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {luts.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} ({l.size}³)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label="Import .cube LUT"
          title="Import .cube LUT"
          onClick={() => input.current?.click()}
        >
          <Upload />
        </Button>
        {lut && (
          <Button
            variant="outline"
            size="icon"
            aria-label="Remove LUT"
            title="Remove LUT"
            onClick={() => applyRecipe("Remove LUT", (r) => void (r.lut = null))}
          >
            <X />
          </Button>
        )}
      </div>
      {lut && (
        <AdjustmentSlider
          label="Intensity"
          historyLabel="LUT intensity"
          min={0}
          max={100}
          defaultValue={100}
          format={(v) => `${v}%`}
          get={(r) => r.lut?.intensity ?? 0}
          set={(r, v) => {
            if (r.lut) r.lut.intensity = v;
          }}
        />
      )}
      <input
        ref={input}
        type="file"
        accept=".cube"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importCube(f);
          e.target.value = "";
        }}
      />
    </Section>
  );
}
