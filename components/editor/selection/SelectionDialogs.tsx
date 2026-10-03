"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToolStore } from "@/store/toolStore";
import { colorRangeSelect, selectionCommands } from "./selectionActions";

export type SelectionDialog = "feather" | "expand" | "contract" | "color-range" | null;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function SelectionDialogs({ open, onClose }: { open: SelectionDialog; onClose: () => void }) {
  const [radius, setRadius] = useState(20);
  const [color, setColor] = useState("#3a6fd0");
  const [fuzz, setFuzz] = useState(80);
  const mode = useToolStore((s) => s.selectionMode);
  const title = { feather: "Feather selection", expand: "Expand selection", contract: "Contract selection", "color-range": "Color range" };

  const apply = async () => {
    if (open === "feather") selectionCommands.feather(radius);
    if (open === "expand") selectionCommands.expand(radius);
    if (open === "contract") selectionCommands.expand(-radius);
    if (open === "color-range") await colorRangeSelect(hexToRgb(color), fuzz, mode);
    onClose();
  };

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void apply();
          }}
        >
          <DialogHeader>
            <DialogTitle>{open ? title[open] : ""}</DialogTitle>
            {open === "color-range" && (
              <DialogDescription>
                Selects pixels of the displayed image similar to a colour. Use the colour picker&apos;s eyedropper (where your browser offers one) to sample from the photo.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="my-4 grid gap-3">
            {open === "color-range" ? (
              <>
                <div className="flex items-center gap-2">
                  <Label htmlFor="range-color">Colour</Label>
                  <input id="range-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-12 rounded border border-input" />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex justify-between text-sm">
                    <Label htmlFor="range-fuzz">Fuzziness</Label>
                    <span className="font-mono text-xs">{fuzz}</span>
                  </div>
                  <Slider id="range-fuzz" aria-label="Fuzziness" min={1} max={300} value={fuzz} onValueChange={(v) => setFuzz(Array.isArray(v) ? v[0] : (v as number))} />
                </div>
              </>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="sel-radius">Radius (px at full resolution)</Label>
                <Input id="sel-radius" type="number" min={1} max={2000} value={radius} onChange={(e) => setRadius(Math.max(1, Math.min(2000, parseInt(e.target.value, 10) || 1)))} autoFocus />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" data-testid="selection-dialog-ok">
              OK
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
