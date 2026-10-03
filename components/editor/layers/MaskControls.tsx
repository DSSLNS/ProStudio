"use client";

import { Brush, Eye, EyeOff, FlipVertical2, PaintBucket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Section } from "../controls/AdjustmentSlider";
import { LiveSlider } from "../controls/LiveSlider";
import { useEditorStore } from "@/store/editorStore";
import { appendMaskOps, patchLayer } from "@/engine/layers/layerOps";
import { emptyMask, type LayerDoc, type MaskDoc } from "@/types/layers";
import { useLayerActions } from "./useLayerActions";

/** Layer mask controls. Masks are operation lists — the layer itself is never modified. */
export function MaskControls({ layer }: { layer: LayerDoc }) {
  const a = useLayerActions();
  const editingMask = useEditorStore((s) => s.editingMask);
  const showMask = useEditorStore((s) => s.showMask);
  const selection = useEditorStore((s) => s.selection);
  const setEditingMask = useEditorStore((s) => s.setEditingMask);
  const setShowMask = useEditorStore((s) => s.setShowMask);
  const setTool = useEditorStore((s) => s.setTool);
  const st = () => useEditorStore.getState();
  const disabled = layer.locked;

  const setMask = (mask: MaskDoc | null, label: string) => {
    st().setLayers(patchLayer(st().layers, layer.id, { mask, maskEnabled: true }), label);
    st().setEditingMask(!!mask);
  };

  if (!layer.mask) {
    return (
      <Section title="Mask">
        <p className="mb-2 text-xs text-muted-foreground">Masks hide parts of this layer non-destructively. White reveals, black hides.</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setMask(emptyMask(1), "Add mask (reveal all)")} data-testid="add-mask-white">
            Reveal all
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setMask(emptyMask(0), "Add mask (hide all)")} data-testid="add-mask-black">
            Hide all
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="col-span-2"
            disabled={disabled || !selection}
            title={selection ? undefined : "Make a selection first"}
            onClick={() => selection && setMask({ base: 0, ops: [{ type: "mask", mode: "add", mask: selection }] }, "Mask from selection")}
            data-testid="mask-from-selection"
          >
            From selection
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Mask"
      actions={
        <Button variant="ghost" size="icon-xs" aria-label="Delete mask" disabled={disabled} onClick={() => setMask(null, "Delete mask")} data-testid="delete-mask">
          <Trash2 />
        </Button>
      }
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={editingMask ? "secondary" : "outline"}
            aria-pressed={editingMask}
            disabled={disabled}
            onClick={() => {
              setEditingMask(true);
              setTool("brush");
            }}
            data-testid="edit-mask"
          >
            <Brush aria-hidden /> {editingMask ? "Painting mask" : "Paint mask"}
          </Button>
          <Button size="sm" variant={showMask ? "secondary" : "outline"} aria-pressed={showMask} onClick={() => setShowMask(!showMask)} data-testid="preview-mask">
            {showMask ? <EyeOff aria-hidden /> : <Eye aria-hidden />} Preview
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => st().setLayers(appendMaskOps(st().layers, layer.id, [{ type: "invert" }]), "Invert mask")} data-testid="invert-mask">
            <FlipVertical2 aria-hidden /> Invert
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setTool("gradient")} title="Drag on the image to draw a gradient mask">
            <PaintBucket aria-hidden /> Gradient
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="mask-enabled"
            checked={layer.maskEnabled}
            disabled={disabled}
            onCheckedChange={(v) => st().setLayers(patchLayer(st().layers, layer.id, { maskEnabled: v }), v ? "Enable mask" : "Disable mask")}
          />
          <Label htmlFor="mask-enabled" className="text-xs">
            Mask enabled
          </Label>
        </div>
        <LiveSlider
          label="Feather"
          min={0}
          max={300}
          value={layer.maskFeather}
          format={(v) => `${Math.round(v)} px`}
          disabled={disabled}
          onLive={(v) => a.patchLive(layer.id, { maskFeather: v })}
          onCommit={() => a.commitLive("Feather mask")}
          testId="mask-feather"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => st().setSelection(layer.mask)} data-testid="mask-to-selection">
            Mask → selection
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || !selection}
            onClick={() => selection && st().setLayers(appendMaskOps(st().layers, layer.id, [{ type: "mask", mode: "add", mask: selection }]), "Add selection to mask")}
          >
            Selection → mask
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {editingMask ? "Brush/eraser now edit this mask. " : ""}Paint with the brush (B) to reveal or hide; X swaps reveal/hide.
        </p>
      </div>
    </Section>
  );
}
