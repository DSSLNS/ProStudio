"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEditorStore, type EditorPanel } from "@/store/editorStore";
import { useSaveProject } from "@/hooks/useProject";
import { key, type Shortcut } from "@/hooks/useKeyboardShortcuts";
import { applyDraftCrop, cancelCrop } from "./CropTool";
import { exportProjectFile } from "@/storage/projectFile";
import { getProject } from "@/storage/projects";
import { saveBlobAs } from "@/lib/fileUtils";
import { normalizeRecipe } from "@/types/edit";
import { useToolStore } from "@/store/toolStore";
import { useLayerActions } from "./layers/useLayerActions";
import { appendMaskOps, findLayer } from "@/engine/layers/layerOps";
import { copySelection, hasAppClipboard, pasteClipboard, selectionCommands } from "./selection/selectionActions";

const CLIPBOARD_KEY = "prostudio.copiedSettings";

export interface EditorDialogs {
  openExport: () => void;
  openShortcuts: () => void;
  openImport: () => void;
  openProjectFile: () => void;
}

/** All editor commands in one place, shared by the menu bar, mobile UI and keyboard shortcuts. */
export function useEditorCommands(dialogs: EditorDialogs) {
  const router = useRouter();
  const save = useSaveProject();
  const layerActions = useLayerActions();

  return useMemo(() => {
    const s = () => useEditorStore.getState();
    const zoomBy = (f: number) => {
      const st = s();
      st.setZoom((st.zoom ?? st.fitZoom) * f);
    };
    const showPanel = (p: EditorPanel) => s().setPanel(p);
    const rotate = (deg: 90 | 270) =>
      s().applyRecipe(deg === 90 ? "Rotate right" : "Rotate left", (r) => {
        r.geometry.rotation = ((r.geometry.rotation + deg) % 360) as 0 | 90 | 180 | 270;
        r.geometry.crop = null;
      });

    const commands = {
      save: () => void save(),
      exportImage: dialogs.openExport,
      exportProject: async () => {
        const p = s().project;
        if (!p) return;
        await save({ silent: true });
        const full = await getProject(p.id);
        if (!full) return;
        const res = await saveBlobAs(await exportProjectFile(full), `${full.name}.prostudio`, "ProStudio project");
        if (res !== "cancelled") toast.success("Project file exported");
      },
      importImage: dialogs.openImport,
      openProject: dialogs.openProjectFile,
      close: () => router.push("/"),
      undo: () => s().undo(),
      redo: () => s().redo(),
      copySettings: () => {
        try {
          sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ ...s().recipe, geometry: undefined }));
          toast.success("Edit settings copied");
        } catch {
          toast.error("Could not copy settings");
        }
      },
      pasteSettings: () => {
        const raw = sessionStorage.getItem(CLIPBOARD_KEY);
        if (!raw) return toast.info("No copied settings yet. Use Edit → Copy settings in another project.");
        const parsed = normalizeRecipe({ ...JSON.parse(raw), geometry: s().recipe.geometry });
        s().applyRecipe("Paste settings", (r) => Object.assign(r, parsed));
      },
      crop: () => s().setTool(s().tool === "crop" ? "move" : "crop"),
      rotateLeft: () => rotate(270),
      rotateRight: () => rotate(90),
      flipH: () => s().applyRecipe("Flip horizontal", (r) => void (r.geometry.flipH = !r.geometry.flipH)),
      flipV: () => s().applyRecipe("Flip vertical", (r) => void (r.geometry.flipV = !r.geometry.flipV)),
      fit: () => s().setZoom(null),
      zoomTo: (z: number) => s().setZoom(z),
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(0.8),
      toggleSplit: () => s().setCompare(s().compare === "split" ? "off" : "split"),
      toggleSideBySide: () => s().setCompare(s().compare === "side-by-side" ? "off" : "side-by-side"),
      showPanel,
      shortcuts: dialogs.openShortcuts,
      /** Delete: with a selection, hide the selected pixels via the active layer's mask; otherwise delete the active layer. */
      deleteSelection: () => {
        const st = s();
        const active = findLayer(st.layers, st.activeLayerId);
        if (!active) return;
        if (st.selection) {
          if (active.locked) return toast.error(`“${active.name}” is locked.`);
          st.setLayers(appendMaskOps(st.layers, active.id, [{ type: "mask", mode: "subtract", mask: st.selection }]), "Delete selected pixels");
        } else if (active.kind !== "base") {
          layerActions.remove(active.id);
        }
      },
    };

    const shortcuts: Shortcut[] = [
      { keys: "Mod+Z", description: "Undo", group: "Edit", match: key("z", { mod: true }), run: commands.undo },
      {
        keys: "Mod+Shift+Z",
        description: "Redo",
        group: "Edit",
        match: key("z", { mod: true, shift: true }),
        run: commands.redo,
      },
      { keys: "Mod+Y", description: "Redo", group: "Edit", match: key("y", { mod: true }), run: commands.redo },
      { keys: "Mod+S", description: "Save project", group: "File", match: key("s", { mod: true }), run: commands.save },
      {
        keys: "Mod+O",
        description: "Open / import",
        group: "File",
        match: key("o", { mod: true }),
        run: commands.importImage,
      },
      {
        keys: "Mod+E",
        description: "Export image",
        group: "File",
        match: key("e", { mod: true }),
        run: commands.exportImage,
      },
      {
        keys: "Mod+Shift+C",
        description: "Copy edit settings",
        group: "Edit",
        match: key("c", { mod: true, shift: true }),
        run: commands.copySettings,
      },
      {
        keys: "Mod+Shift+V",
        description: "Paste edit settings",
        group: "Edit",
        match: key("v", { mod: true, shift: true }),
        run: commands.pasteSettings,
      },
      { keys: "M", description: "Move tool", group: "Tools", match: key("m"), run: () => s().setTool("move") },
      { keys: "H", description: "Hand (pan) tool", group: "Tools", match: key("h"), run: () => s().setTool("hand") },
      { keys: "Z", description: "Zoom tool", group: "Tools", match: key("z"), run: () => s().setTool("zoom") },
      { keys: "C", description: "Crop tool", group: "Tools", match: key("c"), run: commands.crop },
      { keys: "B", description: "Brush", group: "Tools", match: key("b"), run: () => s().setTool("brush") },
      { keys: "N", description: "Pencil", group: "Tools", match: key("n"), run: () => s().setTool("pencil") },
      { keys: "E", description: "Eraser", group: "Tools", match: key("e"), run: () => s().setTool("eraser") },
      { keys: "S", description: "Clone stamp", group: "Tools", match: key("s"), run: () => s().setTool("clone") },
      { keys: "J", description: "Healing brush", group: "Tools", match: key("j"), run: () => s().setTool("heal") },
      { keys: "Shift+J", description: "Spot healing", group: "Tools", match: key("j", { shift: true }), run: () => s().setTool("spot-heal") },
      { keys: "Shift+R", description: "Red-eye removal", group: "Tools", match: key("r", { shift: true }), run: () => s().setTool("redeye") },
      { keys: "D", description: "Dodge", group: "Tools", match: key("d"), run: () => s().setTool("dodge") },
      { keys: "Shift+D", description: "Burn", group: "Tools", match: key("d", { shift: true }), run: () => s().setTool("burn") },
      { keys: "U", description: "Smudge", group: "Tools", match: key("u"), run: () => s().setTool("smudge") },
      { keys: "Shift+E", description: "Background eraser", group: "Tools", match: key("e", { shift: true }), run: () => s().setTool("bg-eraser") },
      { keys: "G", description: "Gradient mask", group: "Tools", match: key("g"), run: () => s().setTool("gradient") },
      {
        keys: "[ / ]",
        description: "Brush size smaller / larger",
        group: "Tools",
        match: (e) => (e.key === "[" || e.key === "]") && !e.metaKey && !e.ctrlKey,
        run: (e) => {
          const b = useToolStore.getState().brush;
          useToolStore.getState().setBrush({ size: Math.max(1, Math.min(2000, Math.round(b.size * (e.key === "]" ? 1.2 : 1 / 1.2)))) });
        },
      },
      {
        keys: "X",
        description: "Swap mask reveal / hide",
        group: "Tools",
        match: key("x"),
        run: () => useToolStore.getState().set({ maskPaint: useToolStore.getState().maskPaint === "reveal" ? "hide" : "reveal" }),
      },
      { keys: "R", description: "Rectangle select", group: "Tools", match: key("r"), run: () => s().setTool("select-rect") },
      { keys: "O", description: "Ellipse select", group: "Tools", match: key("o"), run: () => s().setTool("select-ellipse") },
      { keys: "L", description: "Lasso", group: "Tools", match: key("l"), run: () => s().setTool("lasso") },
      { keys: "P", description: "Polygonal lasso", group: "Tools", match: key("p"), run: () => s().setTool("polygon") },
      { keys: "Q", description: "Selection brush", group: "Tools", match: key("q"), run: () => s().setTool("select-brush") },
      { keys: "W", description: "Magic wand", group: "Tools", match: key("w"), run: () => s().setTool("wand") },
      { keys: "Mod+A", description: "Select all", group: "Edit", match: key("a", { mod: true }), run: selectionCommands.selectAll },
      { keys: "Mod+D", description: "Deselect", group: "Edit", match: key("d", { mod: true }), run: selectionCommands.deselect },
      {
        keys: "Esc",
        description: "Deselect",
        group: "Edit",
        match: (e) => e.key === "Escape" && s().tool !== "crop" && s().tool !== "polygon" && !!s().selection,
        run: selectionCommands.deselect,
      },
      { keys: "Mod+Shift+I", description: "Invert selection", group: "Edit", match: key("i", { mod: true, shift: true }), run: selectionCommands.invert },
      { keys: "Mod+C", description: "Copy (full resolution)", group: "Edit", match: key("c", { mod: true }), run: () => void copySelection() },
      {
        keys: "Mod+V",
        description: "Paste as new layer",
        group: "Edit",
        // Only claim the shortcut when ProStudio has its own clipboard; otherwise the browser's paste event delivers images.
        match: (e) => key("v", { mod: true })(e) && hasAppClipboard(),
        run: () => void pasteClipboard(),
      },
      { keys: "Mod+J", description: "Duplicate layer", group: "Edit", match: key("j", { mod: true }), run: () => layerActions.duplicate() },
      {
        keys: "Delete",
        description: "Delete layer / selected pixels",
        group: "Edit",
        match: (e) => (e.key === "Delete" || e.key === "Backspace") && !e.metaKey && !e.ctrlKey,
        run: () => commands.deleteSelection(),
      },
      {
        keys: "Enter",
        description: "Apply crop",
        group: "Tools",
        match: (e) => e.key === "Enter" && s().tool === "crop",
        run: applyDraftCrop,
      },
      {
        keys: "Esc",
        description: "Cancel crop",
        group: "Tools",
        match: (e) => e.key === "Escape" && s().tool === "crop",
        run: cancelCrop,
      },
      { keys: "Space (hold)", description: "Pan canvas", group: "View", match: () => false, run: () => undefined },
      { keys: "Mod+0", description: "Fit to screen", group: "View", match: key("0", { mod: true }), run: commands.fit },
      {
        keys: "Mod+1",
        description: "Zoom 100%",
        group: "View",
        match: key("1", { mod: true }),
        run: () => commands.zoomTo(1),
      },
      {
        keys: "Mod+=",
        description: "Zoom in",
        group: "View",
        match: (e) => (e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+"),
        run: commands.zoomIn,
      },
      {
        keys: "Mod+-",
        description: "Zoom out",
        group: "View",
        match: (e) => (e.metaKey || e.ctrlKey) && e.key === "-",
        run: commands.zoomOut,
      },
      { keys: "Y", description: "Before/after split", group: "View", match: key("y"), run: commands.toggleSplit },
      { keys: "\\ (hold)", description: "Show original", group: "View", match: () => false, run: () => undefined },
      {
        keys: "?",
        description: "Keyboard shortcuts",
        group: "View",
        match: (e) => e.key === "?",
        run: commands.shortcuts,
      },
    ];
    return { commands, shortcuts };
  }, [dialogs, router, save, layerActions]);
}
