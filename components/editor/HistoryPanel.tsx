"use client";

import { Redo2, RotateCcw, Undo2 } from "lucide-react";
import { Section } from "./controls/AdjustmentSlider";
import { Button } from "@/components/ui/button";
import { useHistoryStore } from "@/store/historyStore";
import { useEditorStore } from "@/store/editorStore";
import { defaultRecipe } from "@/types/edit";
import { cn } from "@/lib/utils";

export function HistoryPanel() {
  const entries = useHistoryStore((s) => s.entries);
  const index = useHistoryStore((s) => s.index);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const jump = useEditorStore((s) => s.jumpToHistory);
  const applyRecipe = useEditorStore((s) => s.applyRecipe);
  return (
    <Section
      title="History"
      actions={
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-xs" aria-label="Undo" onClick={undo} disabled={index <= 0}>
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Redo"
            onClick={redo}
            disabled={index >= entries.length - 1}
          >
            <Redo2 />
          </Button>
        </div>
      }
    >
      <ol className="grid gap-0.5" aria-label="Edit history" data-testid="history-list">
        {entries.map((e, i) => (
          <li key={`${i}-${e.at}`}>
            <button
              type="button"
              onClick={() => jump(i)}
              aria-current={i === index ? "step" : undefined}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                i === index && "bg-muted font-medium",
                i > index && "text-muted-foreground line-through decoration-muted-foreground/40",
              )}
            >
              <span className="truncate">{e.label}</span>
              <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">
                {new Date(e.at).toLocaleTimeString()}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={() =>
          applyRecipe("Reset all", (r) => {
            Object.assign(r, defaultRecipe());
          })
        }
      >
        <RotateCcw aria-hidden /> Reset all adjustments
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        History stores edit settings only (a few KB per step), never copies of the image.
      </p>
    </Section>
  );
}
