"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Section } from "./controls/AdjustmentSlider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditorStore } from "@/store/editorStore";
import { buildCurveEvaluator } from "@/engine/color/curves";
import { IDENTITY_CURVE, type CurveChannel, type CurvePoint } from "@/types/edit";
import { editorRuntime } from "./editorRuntime";
import { useViewState } from "./viewState";

const SIZE = 256;
const CH_COLOR: Record<CurveChannel, string> = { rgb: "#e5e5e5", r: "#ef4444", g: "#22c55e", b: "#3b82f6" };
const CH_HIST: Record<CurveChannel, number> = { rgb: 3, r: 0, g: 1, b: 2 };

function useHistogram(channel: CurveChannel) {
  const version = useViewState((s) => s.histogramVersion);
  const [path, setPath] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => {
      const h = editorRuntime.histogram();
      if (!h) return;
      const off = CH_HIST[channel] * 256;
      let max = 1;
      for (let i = 1; i < 255; i++) max = Math.max(max, h[off + i]);
      let d = `M0 ${SIZE}`;
      for (let i = 0; i < 256; i++) d += ` L${i} ${SIZE - Math.min(1, h[off + i] / max) * SIZE * 0.9}`;
      setPath(`${d} L${SIZE} ${SIZE} Z`);
    }, 120);
    return () => window.clearTimeout(t);
  }, [version, channel]);
  return path;
}

function CurveEditor({ channel }: { channel: CurveChannel }) {
  const points = useEditorStore((s) => s.recipe.curves[channel]);
  const updateRecipe = useEditorStore((s) => s.updateRecipe);
  const commit = useEditorStore((s) => s.commit);
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const hist = useHistogram(channel);

  const path = useMemo(() => {
    const f = buildCurveEvaluator(points);
    let d = "";
    for (let i = 0; i <= 128; i++) {
      const x = i / 128;
      d += `${i ? "L" : "M"}${x * SIZE} ${(1 - Math.max(0, Math.min(1, f(x)))) * SIZE} `;
    }
    return d;
  }, [points]);

  const setPoints = (next: CurvePoint[]) =>
    updateRecipe((r) => {
      r.curves[channel] = next;
    });

  const toCurve = (e: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  };

  const movePoint = (i: number, p: CurvePoint) => {
    const next = points.map((q) => ({ ...q }));
    const isEnd = i === 0 || i === points.length - 1;
    const lo = i === 0 ? 0 : points[i - 1].x + 0.01;
    const hi = i === points.length - 1 ? 1 : points[i + 1].x - 0.01;
    next[i] = {
      x: isEnd && points.length === 2 ? Math.max(lo, Math.min(hi, p.x)) : Math.max(lo, Math.min(hi, p.x)),
      y: p.y,
    };
    setPoints(next);
  };

  const removePoint = (i: number) => {
    if (i === 0 || i === points.length - 1) return;
    setPoints(points.filter((_, k) => k !== i));
    commit(`Curve ${channel} remove point`);
    setActive(null);
  };

  return (
    <div>
      <svg
        ref={svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="aspect-square w-full touch-none rounded-md border border-border bg-black/40"
        role="application"
        aria-label={`${channel.toUpperCase()} curve editor. Click to add a point; drag points; select a point and press Delete to remove it; arrow keys move the selected point.`}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.target !== svg.current && (e.target as Element).tagName !== "path") return;
          const p = toCurve(e);
          const next = [...points.map((q) => ({ ...q })), p].sort((a, b) => a.x - b.x);
          if (next.some((q, k) => k > 0 && Math.abs(q.x - next[k - 1].x) < 0.01)) return;
          setPoints(next);
          const i = next.findIndex((q) => q.x === p.x && q.y === p.y);
          setActive(i);
          dragging.current = i;
          svg.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging.current === null) return;
          movePoint(dragging.current, toCurve(e));
        }}
        onPointerUp={() => {
          if (dragging.current !== null) commit(`Curve ${channel}`);
          dragging.current = null;
        }}
        onKeyDown={(e) => {
          if (active === null) return;
          const step = e.shiftKey ? 0.05 : 0.01;
          const p = points[active];
          if (!p) return;
          const moves: Record<string, CurvePoint> = {
            ArrowUp: { x: p.x, y: Math.min(1, p.y + step) },
            ArrowDown: { x: p.x, y: Math.max(0, p.y - step) },
            ArrowLeft: { x: p.x - step, y: p.y },
            ArrowRight: { x: p.x + step, y: p.y },
          };
          if (moves[e.key]) {
            e.preventDefault();
            movePoint(active, moves[e.key]);
            commit(`Curve ${channel}`);
          } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            removePoint(active);
          } else if (e.key === "Tab" && !e.shiftKey && active < points.length - 1) {
            e.preventDefault();
            setActive(active + 1);
          } else if (e.key === "Tab" && e.shiftKey && active > 0) {
            e.preventDefault();
            setActive(active - 1);
          }
        }}
        onFocus={() => active === null && setActive(0)}
      >
        {hist && <path d={hist} fill={CH_COLOR[channel]} opacity={0.15} pointerEvents="none" />}
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} stroke="currentColor" className="text-white/10" pointerEvents="none">
            <line x1={f * SIZE} y1={0} x2={f * SIZE} y2={SIZE} />
            <line x1={0} y1={f * SIZE} x2={SIZE} y2={f * SIZE} />
          </g>
        ))}
        <line
          x1={0}
          y1={SIZE}
          x2={SIZE}
          y2={0}
          stroke="white"
          strokeOpacity={0.15}
          strokeDasharray="4 4"
          pointerEvents="none"
        />
        <path d={path} fill="none" stroke={CH_COLOR[channel]} strokeWidth={2} pointerEvents="none" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x * SIZE}
            cy={(1 - p.y) * SIZE}
            r={i === active ? 7 : 5}
            fill={i === active ? CH_COLOR[channel] : "#111"}
            stroke={CH_COLOR[channel]}
            strokeWidth={2}
            className="cursor-grab"
            onPointerDown={(e) => {
              e.stopPropagation();
              setActive(i);
              dragging.current = i;
              svg.current!.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              removePoint(i);
            }}
          />
        ))}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
        {active !== null && points[active]
          ? `Point ${active + 1}: in ${Math.round(points[active].x * 255)} → out ${Math.round(points[active].y * 255)}`
          : "Click the curve area to add points. Double-click a point to remove it."}
      </p>
    </div>
  );
}

export function CurvesPanel() {
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const applyRecipe = useEditorStore((s) => s.applyRecipe);
  return (
    <Section
      title="Tone curve"
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Reset curve"
          title="Reset this curve"
          onClick={() =>
            applyRecipe(`Reset ${channel} curve`, (r) => {
              r.curves[channel] = IDENTITY_CURVE.map((p) => ({ ...p }));
            })
          }
        >
          <RotateCcw />
        </Button>
      }
    >
      <Tabs value={channel} onValueChange={(v) => setChannel(v as CurveChannel)} className="mb-2">
        <TabsList className="w-full">
          <TabsTrigger value="rgb">RGB</TabsTrigger>
          <TabsTrigger value="r">Red</TabsTrigger>
          <TabsTrigger value="g">Green</TabsTrigger>
          <TabsTrigger value="b">Blue</TabsTrigger>
        </TabsList>
      </Tabs>
      <CurveEditor key={channel} channel={channel} />
    </Section>
  );
}
