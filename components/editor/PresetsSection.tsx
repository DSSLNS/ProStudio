"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Section } from "./controls/AdjustmentSlider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditorStore } from "@/store/editorStore";
import { getDB, newId, type PresetRecord } from "@/storage/indexedDB";
import { normalizeRecipe, type EditRecipe } from "@/types/edit";

/** Presets store tone & colour settings only — never geometry (crop/rotation are per-photo). */
const PRESET_KEYS = ["light", "color", "hsl", "curves", "grading", "colorBalance", "detail", "effects", "lut"] as const;

export function PresetsSection() {
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [name, setName] = useState("");
  const applyRecipe = useEditorStore((s) => s.applyRecipe);

  const refresh = async () =>
    setPresets((await (await getDB()).getAll("presets")).sort((a, b) => a.name.localeCompare(b.name)));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load stored presets
    void refresh();
  }, []);

  const save = async () => {
    const recipe = useEditorStore.getState().recipe;
    const partial: Partial<EditRecipe> = {};
    for (const k of PRESET_KEYS) (partial as Record<string, unknown>)[k] = structuredClone(recipe[k]);
    const rec: PresetRecord = {
      id: newId(),
      name: name.trim().slice(0, 60) || `Preset ${presets.length + 1}`,
      recipe: partial,
      createdAt: Date.now(),
    };
    await (await getDB()).put("presets", rec);
    setName("");
    await refresh();
    toast.success(`Preset “${rec.name}” saved`);
  };

  const apply = (p: PresetRecord) =>
    applyRecipe(`Preset: ${p.name}`, (r) => {
      const n = normalizeRecipe({ ...r, ...p.recipe, geometry: r.geometry });
      for (const k of PRESET_KEYS) (r as unknown as Record<string, unknown>)[k] = n[k];
    });

  return (
    <Section title="Presets">
      <form
        className="mb-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name"
          aria-label="New preset name"
          className="h-8"
        />
        <Button type="submit" size="sm" variant="outline">
          <Plus aria-hidden /> Save
        </Button>
      </form>
      {presets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Save the current look (tone, colour, curves, effects) as a reusable preset.
        </p>
      ) : (
        <ul className="grid gap-1">
          {presets.map((p) => (
            <li key={p.id} className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => apply(p)}>
                {p.name}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete preset ${p.name}`}
                onClick={async () => {
                  await (await getDB()).delete("presets", p.id);
                  void refresh();
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
