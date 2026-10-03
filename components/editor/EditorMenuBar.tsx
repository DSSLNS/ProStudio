"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { displayKeys } from "@/hooks/useKeyboardShortcuts";
import type { useEditorCommands } from "./useEditorCommands";
import type { SelectionDialog } from "./selection/SelectionDialogs";
import { useLayerActions } from "./layers/useLayerActions";
import { useEditorStore } from "@/store/editorStore";
import {
  adjustmentFromSelection,
  copySelection,
  cropToSelection,
  pasteClipboard,
  selectionCommands,
} from "./selection/selectionActions";

type Commands = ReturnType<typeof useEditorCommands>["commands"];

interface Item {
  label: string;
  run: () => void;
  keys?: string;
  disabled?: boolean;
}

function Menu({ label, items }: { label: string; items: (Item | "sep")[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal" />}>
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {items.map((it, i) =>
          it === "sep" ? (
            <DropdownMenuSeparator key={i} />
          ) : (
            <DropdownMenuItem key={it.label} onClick={it.run} disabled={it.disabled}>
              {it.label}
              {it.keys && <DropdownMenuShortcut>{displayKeys(it.keys)}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Desktop menu bar. Only implemented actions are listed. */
export function EditorMenuBar({
  commands,
  onAutoEdit,
  onSelectionDialog,
}: {
  commands: Commands;
  onAutoEdit: () => void;
  onSelectionDialog: (d: SelectionDialog) => void;
}) {
  const layerActions = useLayerActions();
  const hasSelection = useEditorStore((s) => !!s.selection);
  return (
    <nav aria-label="Editor menu" className="flex items-center">
      <Menu
        label="File"
        items={[
          { label: "Import image…", run: commands.importImage, keys: "Mod+O" },
          { label: "Open project file…", run: commands.openProject },
          "sep",
          { label: "Save project", run: commands.save, keys: "Mod+S" },
          { label: "Export project file (.prostudio)…", run: () => void commands.exportProject() },
          "sep",
          { label: "Export image…", run: commands.exportImage, keys: "Mod+E" },
          "sep",
          { label: "Close", run: commands.close },
        ]}
      />
      <Menu
        label="Edit"
        items={[
          { label: "Undo", run: commands.undo, keys: "Mod+Z" },
          { label: "Redo", run: commands.redo, keys: "Mod+Shift+Z" },
          "sep",
          { label: "Copy edit settings", run: commands.copySettings, keys: "Mod+Shift+C" },
          { label: "Paste edit settings", run: commands.pasteSettings, keys: "Mod+Shift+V" },
          "sep",
          { label: "History…", run: () => commands.showPanel("history") },
          { label: "Keyboard shortcuts…", run: commands.shortcuts, keys: "?" },
        ]}
      />
      <Menu
        label="Image"
        items={[
          { label: "Auto Edit…", run: onAutoEdit },
          "sep",
          { label: "Crop", run: commands.crop, keys: "C" },
          { label: "Rotate 90° left", run: commands.rotateLeft },
          { label: "Rotate 90° right", run: commands.rotateRight },
          { label: "Flip horizontal", run: commands.flipH },
          { label: "Flip vertical", run: commands.flipV },
          { label: "Straighten & perspective…", run: () => commands.showPanel("geometry") },
          "sep",
          { label: "Image size (on export)…", run: commands.exportImage },
        ]}
      />
      <Menu
        label="Filter"
        items={[
          { label: "Sharpen…", run: () => commands.showPanel("detail") },
          { label: "Noise reduction…", run: () => commands.showPanel("detail") },
          { label: "Clarity / Texture / Dehaze…", run: () => commands.showPanel("light") },
          { label: "Vignette & grain…", run: () => commands.showPanel("effects") },
          { label: "Apply LUT…", run: () => commands.showPanel("color") },
        ]}
      />
      <Menu
        label="View"
        items={[
          { label: "Fit to screen", run: commands.fit, keys: "Mod+0" },
          { label: "100%", run: () => commands.zoomTo(1), keys: "Mod+1" },
          { label: "200%", run: () => commands.zoomTo(2) },
          { label: "400%", run: () => commands.zoomTo(4) },
          { label: "Zoom in", run: commands.zoomIn, keys: "Mod+=" },
          { label: "Zoom out", run: commands.zoomOut, keys: "Mod+-" },
          "sep",
          { label: "Before / after split", run: commands.toggleSplit, keys: "Y" },
          { label: "Before / after side by side", run: commands.toggleSideBySide },
        ]}
      />
      <Menu
        label="Layer"
        items={[
          { label: "New text layer", run: () => layerActions.addText() },
          { label: "New rectangle", run: () => layerActions.addShape("rectangle") },
          { label: "New ellipse", run: () => layerActions.addShape("ellipse") },
          { label: "New adjustment layer", run: () => layerActions.addAdjustment() },
          "sep",
          { label: "Duplicate layer", run: () => layerActions.duplicate(), keys: "Mod+J" },
          { label: "Group layer", run: () => layerActions.group() },
          { label: "Delete layer", run: () => layerActions.remove() },
          "sep",
          { label: "Layers panel…", run: () => commands.showPanel("layers") },
        ]}
      />
      <Menu
        label="Select"
        items={[
          { label: "All", run: selectionCommands.selectAll, keys: "Mod+A" },
          { label: "Deselect", run: selectionCommands.deselect, keys: "Mod+D" },
          { label: "Inverse", run: selectionCommands.invert, keys: "Mod+Shift+I" },
          "sep",
          { label: "Color range…", run: () => onSelectionDialog("color-range") },
          "sep",
          { label: "Feather…", run: () => onSelectionDialog("feather"), disabled: !hasSelection },
          { label: "Expand…", run: () => onSelectionDialog("expand"), disabled: !hasSelection },
          { label: "Contract…", run: () => onSelectionDialog("contract"), disabled: !hasSelection },
          "sep",
          { label: "Copy", run: () => void copySelection(), keys: "Mod+C" },
          { label: "Paste", run: () => void pasteClipboard(), keys: "Mod+V" },
          { label: "Delete selected pixels (mask)", run: commands.deleteSelection, keys: "Delete", disabled: !hasSelection },
          { label: "Crop to selection", run: cropToSelection, disabled: !hasSelection },
          { label: "New adjustment layer from selection", run: adjustmentFromSelection, disabled: !hasSelection },
        ]}
      />
      <Menu
        label="Export"
        items={[
          { label: "Export image…", run: commands.exportImage, keys: "Mod+E" },
          { label: "Export project file…", run: () => void commands.exportProject() },
        ]}
      />
    </nav>
  );
}
