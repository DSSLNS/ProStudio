"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Columns2, Download, Eye, Keyboard, Redo2, Save, Undo2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditorStore } from "@/store/editorStore";
import { useHistoryStore } from "@/store/historyStore";
import { useAutoSave } from "@/hooks/useProject";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useImportFiles } from "@/hooks/useImportFiles";
import { ACCEPT_ATTR } from "@/lib/fileUtils";
import { cn } from "@/lib/utils";
import { EditorCanvas } from "./EditorCanvas";
import { EditorMenuBar } from "./EditorMenuBar";
import { EditorToolbar } from "./EditorToolbar";
import { StatusBar } from "./StatusBar";
import { PANELS, PanelContent } from "./PanelHost";
import { MobilePanels } from "./MobilePanels";
import { ExportDialog } from "./ExportDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { AutoEditDialog } from "./AutoEditDialog";
import { useEditorCommands } from "./useEditorCommands";
import { ToolOptionsBar } from "./tools/ToolOptionsBar";
import { SelectionDialogs, type SelectionDialog } from "./selection/SelectionDialogs";
import { pasteImageFile } from "./selection/selectionActions";

function SaveState() {
  const dirty = useEditorStore((s) => s.dirty);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  return (
    <span className="hidden text-xs text-muted-foreground lg:inline" aria-live="polite">
      {dirty ? "Unsaved changes" : lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : ""}
    </span>
  );
}

export function EditorShell() {
  const project = useEditorStore((s) => s.project);
  const panel = useEditorStore((s) => s.panel);
  const setPanel = useEditorStore((s) => s.setPanel);
  const compare = useEditorStore((s) => s.compare);
  const setCompare = useEditorStore((s) => s.setCompare);
  const setShowOriginal = useEditorStore((s) => s.setShowOriginal);
  const canUndo = useHistoryStore((s) => s.index > 0);
  const canRedo = useHistoryStore((s) => s.index < s.entries.length - 1);
  const isMobile = useIsMobile();
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [selDialog, setSelDialog] = useState<SelectionDialog>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const { importFiles } = useImportFiles();
  useAutoSave();

  const dialogs = useMemo(
    () => ({
      openExport: () => setExportOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      openImport: () => importInput.current?.click(),
      openProjectFile: () => projectInput.current?.click(),
    }),
    [],
  );
  const { commands, shortcuts } = useEditorCommands(dialogs);
  useKeyboardShortcuts(shortcuts);

  // Hold "\" to temporarily show the unedited original.
  useEffect(() => {
    const down = (e: KeyboardEvent) =>
      e.key === "\\" && !(e.target instanceof HTMLInputElement) && setShowOriginal(true);
    const up = (e: KeyboardEvent) => e.key === "\\" && setShowOriginal(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setShowOriginal]);

  // Pasting an image from the system clipboard adds it as a new layer.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void pasteImageFile(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Warn before leaving with unsaved changes when auto-save is off.
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  const originalButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Hold to show original"
      title="Hold to show original (\\)"
      onPointerDown={() => setShowOriginal(true)}
      onPointerUp={() => setShowOriginal(false)}
      onPointerLeave={() => setShowOriginal(false)}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setShowOriginal(true)}
      onKeyUp={() => setShowOriginal(false)}
      data-testid="show-original"
    >
      <Eye />
    </Button>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card px-2 pt-[env(safe-area-inset-top)]">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Back to home">
          <ArrowLeft />
        </Link>
        {!isMobile && <EditorMenuBar commands={commands} onAutoEdit={() => setAutoOpen(true)} onSelectionDialog={setSelDialog} />}
        <h1
          className="mx-2 min-w-0 flex-1 truncate text-center text-sm font-medium md:flex-none md:text-left"
          title={project?.name}
        >
          {project?.name}
        </h1>
        <div className="ml-auto flex items-center gap-0.5">
          <SaveState />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Undo"
            onClick={commands.undo}
            disabled={!canUndo}
            data-testid="undo"
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Redo"
            onClick={commands.redo}
            disabled={!canRedo}
            data-testid="redo"
          >
            <Redo2 />
          </Button>
          {originalButton}
          {!isMobile && (
            <>
              <Button
                variant={compare === "split" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Before/after split"
                aria-pressed={compare === "split"}
                onClick={commands.toggleSplit}
                data-testid="compare-split"
              >
                <Columns2 />
              </Button>
              <Button
                variant={compare === "side-by-side" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={compare === "side-by-side"}
                onClick={() => setCompare(compare === "side-by-side" ? "off" : "side-by-side")}
              >
                Side by side
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Save project" onClick={commands.save}>
                <Save />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" onClick={commands.shortcuts}>
                <Keyboard />
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => setExportOpen(true)} className="ml-1" data-testid="open-export">
            <Download aria-hidden /> <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {!isMobile && (
          <aside className="min-h-0 shrink-0 border-r border-border bg-card" aria-label="Toolbox">
            <EditorToolbar />
          </aside>
        )}
        <main id="main" className="relative flex min-w-0 flex-1 flex-col">
          {isMobile && (
            <div className="border-b border-border bg-card">
              <EditorToolbar horizontal />
            </div>
          )}
          <ToolOptionsBar />
          <div className="relative min-h-0 flex-1">
            <EditorCanvas />
          </div>
        </main>
        {!isMobile && (
          <aside className="flex w-80 shrink-0 border-l border-border bg-card lg:w-[22rem]" aria-label="Adjustments">
            <div
              className="flex w-11 shrink-0 flex-col gap-1 border-r border-border p-1"
              role="tablist"
              aria-orientation="vertical"
              aria-label="Panels"
            >
              {PANELS.map((p) => (
                <Tooltip key={p.id}>
                  <TooltipTrigger
                    render={
                      <Button
                        role="tab"
                        aria-selected={panel === p.id}
                        aria-controls="editor-panel"
                        aria-label={p.label}
                        variant={panel === p.id ? "secondary" : "ghost"}
                        size="icon-sm"
                        onClick={() => setPanel(p.id)}
                        data-testid={`panel-${p.id}`}
                      />
                    }
                  >
                    <p.icon />
                  </TooltipTrigger>
                  <TooltipContent side="left">{p.label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <div
              id="editor-panel"
              role="tabpanel"
              aria-label={PANELS.find((p) => p.id === panel)?.label}
              className={cn("min-w-0 flex-1 overflow-y-auto")}
            >
              <PanelContent panel={panel} />
            </div>
          </aside>
        )}
      </div>

      {isMobile ? (
        <MobilePanels onExport={() => setExportOpen(true)} onAutoEdit={() => setAutoOpen(true)} />
      ) : (
        <StatusBar />
      )}

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} shortcuts={shortcuts} />
      <AutoEditDialog open={autoOpen} onOpenChange={setAutoOpen} />
      <SelectionDialogs open={selDialog} onClose={() => setSelDialog(null)} />
      <input
        ref={importInput}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".prostudio"
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
