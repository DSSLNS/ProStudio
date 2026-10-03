import type { GridType } from "@/store/uiStore";

const PHI = 0.381966; // 1 − 1/φ

function lines(type: GridType): { v: number[]; h: number[] } {
  switch (type) {
    case "thirds":
      return { v: [1 / 3, 2 / 3], h: [1 / 3, 2 / 3] };
    case "golden":
      return { v: [PHI, 1 - PHI], h: [PHI, 1 - PHI] };
    case "center":
      return { v: [0.5], h: [0.5] };
    default:
      return { v: [], h: [] };
  }
}

/** Composition grid drawn inside the framing rectangle. */
export function CameraGrid({ type }: { type: GridType }) {
  if (type === "none") return null;
  if (type === "square") {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
        <div className="aspect-square h-full max-h-full max-w-full border border-white/50" />
      </div>
    );
  }
  const { v, h } = lines(type);
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      {v.map((x) => (
        <line
          key={`v${x}`}
          x1={x * 100}
          x2={x * 100}
          y1={0}
          y2={100}
          stroke="white"
          strokeOpacity={0.5}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {h.map((y) => (
        <line
          key={`h${y}`}
          y1={y * 100}
          y2={y * 100}
          x1={0}
          x2={100}
          stroke="white"
          strokeOpacity={0.5}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export function CenterMarker() {
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2" aria-hidden>
      <div className="absolute top-1/2 left-0 h-px w-full bg-white/80" />
      <div className="absolute top-0 left-1/2 h-full w-px bg-white/80" />
    </div>
  );
}
