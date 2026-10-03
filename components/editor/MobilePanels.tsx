"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns2, Download, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore, type EditorPanel } from "@/store/editorStore";
import { PANELS, PanelContent } from "./PanelHost";
import { cn } from "@/lib/utils";

/**
 * Touch-first editing UI for phones: a scrollable bottom tool strip and a
 * non-modal bottom panel (the photo stays visible above it). Swipe the panel
 * header left/right to switch panels, or down to close.
 */
export function MobilePanels({ onExport, onAutoEdit }: { onExport: () => void; onAutoEdit: () => void }) {
  const panel = useEditorStore((s) => s.panel);
  const setPanel = useEditorStore((s) => s.setPanel);
  const compare = useEditorStore((s) => s.compare);
  const setCompare = useEditorStore((s) => s.setCompare);
  const setTool = useEditorStore((s) => s.setTool);
  const [open, setOpen] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const idx = PANELS.findIndex((p) => p.id === panel);
  const go = (d: number) => setPanel(PANELS[(idx + d + PANELS.length) % PANELS.length].id);
  const choose = (id: EditorPanel) => {
    if (open && panel === id) setOpen(false);
    else {
      setPanel(id);
      setOpen(true);
      if (id === "geometry") setTool("crop");
    }
  };

  return (
    <div className="flex flex-col border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
      {open && (
        <div className="flex max-h-[45dvh] flex-col" role="region" aria-label={`${PANELS[idx]?.label} panel`}>
          <div
            className="flex touch-none items-center gap-1 border-b border-border px-2 py-1"
            onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
            onPointerUp={(e) => {
              const s = swipe.current;
              swipe.current = null;
              if (!s) return;
              const dx = e.clientX - s.x;
              const dy = e.clientY - s.y;
              if (dy > 50 && Math.abs(dy) > Math.abs(dx)) setOpen(false);
              else if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
            }}
          >
            <Button variant="ghost" size="icon-sm" aria-label="Previous panel" onClick={() => go(-1)}>
              <ChevronLeft />
            </Button>
            <div className="mx-auto flex flex-col items-center">
              <span className="mb-0.5 h-1 w-10 rounded-full bg-muted-foreground/40" aria-hidden />
              <span className="text-sm font-medium">{PANELS[idx]?.label}</span>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Next panel" onClick={() => go(1)}>
              <ChevronRight />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          <div className="overflow-y-auto overscroll-contain [&_[data-slot=slider-thumb]]:size-5">
            <PanelContent panel={panel} />
          </div>
        </div>
      )}
      <nav aria-label="Editing tools" className="flex gap-1 overflow-x-auto px-2 py-1.5">
        <ToolButton label="Auto" onClick={onAutoEdit} active={false}>
          <Sparkles />
        </ToolButton>
        {PANELS.map((p) => (
          <ToolButton
            key={p.id}
            label={p.label.split(" ")[0]}
            onClick={() => choose(p.id)}
            active={open && panel === p.id}
          >
            <p.icon />
          </ToolButton>
        ))}
        <ToolButton
          label="Compare"
          onClick={() => setCompare(compare === "split" ? "off" : "split")}
          active={compare === "split"}
        >
          <Columns2 />
        </ToolButton>
        <ToolButton label="Export" onClick={onExport} active={false}>
          <Download />
        </ToolButton>
      </nav>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-12 min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-2 text-[11px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-5",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
      {label}
    </button>
  );
}
