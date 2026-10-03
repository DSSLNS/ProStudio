"use client";

import { Aperture, BrainCircuit, Crop, History, Info, Layers, Palette, Spline, Sun, Wand2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EditorPanel } from "@/store/editorStore";
import { AdjustmentsPanel } from "./AdjustmentsPanel";
import { ColorPanel } from "./ColorPanel";
import { CurvesPanel } from "./CurvesPanel";
import { DetailPanel, EffectsPanel } from "./DetailEffectsPanels";
import { GeometryPanel } from "./GeometryPanel";
import { HistoryPanel } from "./HistoryPanel";
import { InfoPanel } from "./InfoPanel";
import { LayersPanel } from "./layers/LayersPanel";
import dynamic from "next/dynamic";

// AI UI (and its model manifest/client) loads only when the AI panel is opened.
const AiPanel = dynamic(() => import("./ai/AiPanel").then((m) => m.AiPanel), {
  loading: () => <p className="p-4 text-xs text-muted-foreground">Loading AI tools…</p>,
});

export const PANELS: { id: EditorPanel; label: string; icon: LucideIcon }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "color", label: "Color", icon: Palette },
  { id: "curves", label: "Curves", icon: Spline },
  { id: "detail", label: "Detail", icon: Aperture },
  { id: "effects", label: "Effects", icon: Wand2 },
  { id: "geometry", label: "Crop & Geometry", icon: Crop },
  { id: "layers", label: "Layers", icon: Layers },
  { id: "ai", label: "AI", icon: BrainCircuit },
  { id: "history", label: "History", icon: History },
  { id: "info", label: "Info", icon: Info },
];

export function PanelContent({ panel }: { panel: EditorPanel }) {
  switch (panel) {
    case "light":
      return <AdjustmentsPanel />;
    case "color":
      return <ColorPanel />;
    case "curves":
      return <CurvesPanel />;
    case "detail":
      return <DetailPanel />;
    case "effects":
      return <EffectsPanel />;
    case "geometry":
      return <GeometryPanel />;
    case "layers":
      return <LayersPanel />;
    case "ai":
      return <AiPanel />;
    case "history":
      return <HistoryPanel />;
    case "info":
      return <InfoPanel />;
  }
}
