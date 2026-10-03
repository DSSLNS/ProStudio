"use client";

import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  GripVertical,
  ImagePlus,
  Lock,
  LockOpen,
  Plus,
  Shapes,
  SlidersHorizontal,
  Trash2,
  Type,
  ArrowUp,
  ArrowDown,
  Ungroup,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Section } from "../controls/AdjustmentSlider";
import { LiveSlider } from "../controls/LiveSlider";
import { useEditorStore } from "@/store/editorStore";
import { displayRows, moveLayer, type DropPosition } from "@/engine/layers/layerOps";
import { BASE_LAYER_ID, BLEND_LABELS, BLEND_MODES, type BlendMode, type LayerDoc } from "@/types/layers";
import { LayerThumb } from "./LayerThumb";
import { LayerProperties } from "./LayerProperties";
import { MaskControls } from "./MaskControls";
import { useLayerActions } from "./useLayerActions";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<LayerDoc["kind"], string> = {
  base: "Photo",
  image: "Image",
  text: "Text",
  shape: "Shape",
  adjustment: "Adjustment",
  group: "Group",
  paint: "Paint",
  retouch: "Retouch",
};

function LayerRow({
  layer,
  depth,
  onDragStart,
  onDrop,
  dropHint,
}: {
  layer: LayerDoc;
  depth: number;
  onDragStart: (id: string) => void;
  onDrop: (targetId: string, pos: DropPosition) => void;
  dropHint: (targetId: string, pos: DropPosition | null) => void;
}) {
  const a = useLayerActions();
  const active = useEditorStore((s) => s.activeLayerId === layer.id);
  const editingMask = useEditorStore((s) => s.editingMask && s.activeLayerId === layer.id);
  const setActive = useEditorStore((s) => s.setActiveLayer);
  const setEditingMask = useEditorStore((s) => s.setEditingMask);
  const [renaming, setRenaming] = useState(false);
  const isBase = layer.kind === "base";

  const posFor = (e: React.DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    if (layer.kind === "group" && f > 0.3 && f < 0.7) return "inside";
    return f < 0.5 ? "above" : "below";
  };

  return (
    <li
      className={cn(
        "group/row flex items-center gap-1.5 rounded-md border border-transparent px-1 py-1 text-xs",
        active ? "border-border bg-muted" : "hover:bg-muted/60",
        !layer.visible && "opacity-60",
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
      draggable={!isBase}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", layer.id);
        onDragStart(layer.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        dropHint(layer.id, posFor(e));
      }}
      onDragLeave={() => dropHint(layer.id, null)}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(layer.id, posFor(e));
      }}
      data-testid="layer-row"
      data-layer-name={layer.name}
      aria-current={active ? "true" : undefined}
    >
      {!isBase ? (
        <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
      ) : (
        <span className="w-3.5" />
      )}
      {layer.kind === "group" ? (
        <button
          type="button"
          aria-label={layer.collapsed ? `Expand ${layer.name}` : `Collapse ${layer.name}`}
          onClick={() =>
            a.patch(
              layer.id,
              { collapsed: !layer.collapsed } as Partial<LayerDoc>,
              layer.collapsed ? "Expand group" : "Collapse group",
            )
          }
        >
          {layer.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        aria-pressed={layer.visible}
        onClick={() => a.toggleVisible(layer.id)}
      >
        {layer.visible ? <Eye /> : <EyeOff />}
      </Button>
      <button
        type="button"
        className={cn(
          "rounded focus-visible:outline-2 focus-visible:outline-ring",
          active && !editingMask && "ring-2 ring-brand",
        )}
        onClick={() => {
          setActive(layer.id);
          setEditingMask(false);
        }}
        aria-label={`Select ${layer.name} content`}
      >
        <LayerThumb layer={layer} />
      </button>
      {layer.mask && (
        <button
          type="button"
          className={cn(
            "rounded focus-visible:outline-2 focus-visible:outline-ring",
            editingMask && "ring-2 ring-brand",
            !layer.maskEnabled && "opacity-40",
          )}
          onClick={() => {
            setActive(layer.id);
            setEditingMask(true);
          }}
          aria-label={`Edit mask of ${layer.name}`}
          data-testid="mask-thumb"
        >
          <LayerThumb layer={layer} mask />
        </button>
      )}
      <div
        className="min-w-0 flex-1"
        onClick={() => setActive(layer.id)}
        onDoubleClick={() => !isBase && setRenaming(true)}
      >
        {renaming ? (
          <input
            autoFocus
            aria-label="Layer name"
            className="w-full rounded bg-background px-1 py-0.5 text-xs outline-none ring-1 ring-ring"
            defaultValue={layer.name}
            onBlur={(e) => {
              a.rename(layer.id, e.target.value);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <>
            <p className="truncate font-medium">{layer.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {KIND_LABEL[layer.kind]}
              {layer.blendMode !== "normal" ? ` · ${BLEND_LABELS[layer.blendMode]}` : ""}
              {layer.opacity < 100 ? ` · ${Math.round(layer.opacity)}%` : ""}
            </p>
          </>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        aria-pressed={layer.locked}
        onClick={() => a.toggleLocked(layer.id)}
      >
        {layer.locked ? (
          <Lock />
        ) : (
          <LockOpen className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" />
        )}
      </Button>
    </li>
  );
}

export function LayersPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeId = useEditorStore((s) => s.activeLayerId);
  const setLayers = useEditorStore((s) => s.setLayers);
  const a = useLayerActions();
  const file = useRef<HTMLInputElement>(null);
  const dragging = useRef<string | null>(null);
  const [hint, setHint] = useState<{ id: string; pos: DropPosition } | null>(null);
  const active = layers.find((l) => l.id === activeId);
  const rows = displayRows(layers);

  return (
    <div>
      <Section
        title="Layers"
        actions={
          <div className="flex gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-xs" aria-label="Add layer" data-testid="add-layer" />}
              >
                <Plus />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onClick={() => file.current?.click()}>
                  <ImagePlus /> Image from file…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => a.addText()}>
                  <Type /> Text
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => a.addShape("rectangle")}>
                  <Shapes /> Rectangle
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => a.addShape("ellipse")}>
                  <Shapes /> Ellipse
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => a.addAdjustment()}>
                  <SlidersHorizontal /> Adjustment layer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => a.group()} disabled={!active || active.kind === "base"}>
                  <FolderPlus /> Group active layer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Duplicate layer"
              title="Duplicate (Mod+J)"
              onClick={() => a.duplicate()}
              disabled={!active || active.kind === "base"}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete layer"
              onClick={() => a.remove()}
              disabled={!active || active.kind === "base"}
              data-testid="delete-layer"
            >
              <Trash2 />
            </Button>
          </div>
        }
      >
        <ul
          className="grid gap-0.5"
          aria-label="Layer stack (top first). Drag to reorder."
          data-testid="layer-list"
          onDragEnd={() => setHint(null)}
        >
          {rows.map(({ layer, depth }) => (
            <div key={layer.id} className="relative">
              {hint?.id === layer.id && (
                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 z-10 border-brand",
                    hint.pos === "above" && "top-0 border-t-2",
                    hint.pos === "below" && "bottom-0 border-b-2",
                    hint.pos === "inside" && "inset-y-0 rounded-md border-2",
                  )}
                />
              )}
              <LayerRow
                layer={layer}
                depth={depth}
                onDragStart={(id) => (dragging.current = id)}
                dropHint={(id, pos) => setHint(pos ? { id, pos } : null)}
                onDrop={(targetId, pos) => {
                  const id = dragging.current;
                  dragging.current = null;
                  setHint(null);
                  if (!id) return;
                  const next = moveLayer(layers, id, targetId, pos);
                  if (next !== layers) setLayers(next, "Reorder layers");
                }}
              />
            </div>
          ))}
        </ul>
        {active && active.kind !== "base" && (
          <div className="mt-2 flex flex-wrap gap-1">
            <Button variant="outline" size="xs" onClick={() => a.nudge(active.id, 1)} aria-label="Move layer up">
              <ArrowUp aria-hidden /> Up
            </Button>
            <Button variant="outline" size="xs" onClick={() => a.nudge(active.id, -1)} aria-label="Move layer down">
              <ArrowDown aria-hidden /> Down
            </Button>
            {active.kind === "group" && (
              <Button variant="outline" size="xs" onClick={() => a.ungroup(active.id)}>
                <Ungroup aria-hidden /> Ungroup
              </Button>
            )}
          </div>
        )}
        <input
          ref={file}
          type="file"
          accept="image/*,.tif,.tiff,.svg,.heic,.heif"
          hidden
          data-testid="layer-image-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void a.addImageFromFile(f);
            e.target.value = "";
          }}
        />
      </Section>

      {active && (
        <Section title={`${active.name} — ${KIND_LABEL[active.kind]}`}>
          <div className="grid gap-2">
            {active.kind !== "retouch" && (
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground">Blend mode</span>
                <Select
                  value={active.blendMode}
                  disabled={active.locked || active.kind === "base"}
                  onValueChange={(v) => a.patch(active.id, { blendMode: v as BlendMode }, "Blend mode")}
                >
                  <SelectTrigger className="h-8" aria-label="Blend mode" data-testid="blend-mode">
                    <SelectValue>{BLEND_LABELS[active.blendMode]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {BLEND_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {BLEND_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <LiveSlider
              label="Opacity"
              min={0}
              max={100}
              value={active.opacity}
              format={(v) => `${Math.round(v)}%`}
              disabled={active.locked}
              onLive={(v) => a.patchLive(active.id, { opacity: v })}
              onCommit={() => a.commitLive("Layer opacity")}
              testId="layer-opacity"
            />
            <LayerProperties layer={active} />
          </div>
        </Section>
      )}
      {active && <MaskControls layer={active} />}
      {active?.id === BASE_LAYER_ID && layers.length === 1 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Add text, shapes, images or adjustment layers with the + button.
        </p>
      )}
    </div>
  );
}
