import type { CropRect } from "@/types/edit";

/** Darkens the area outside the selected aspect ratio. Purely visual — pixels are never cropped. */
export function FramingMask({ rect, label }: { rect: CropRect | null; label?: string }) {
  if (!rect) return null;
  const shade = "absolute bg-black/55";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className={shade} style={{ left: 0, top: 0, right: 0, height: `${rect.y * 100}%` }} />
      <div className={shade} style={{ left: 0, bottom: 0, right: 0, height: `${(1 - rect.y - rect.height) * 100}%` }} />
      <div
        className={shade}
        style={{ left: 0, top: `${rect.y * 100}%`, width: `${rect.x * 100}%`, height: `${rect.height * 100}%` }}
      />
      <div
        className={shade}
        style={{
          right: 0,
          top: `${rect.y * 100}%`,
          width: `${(1 - rect.x - rect.width) * 100}%`,
          height: `${rect.height * 100}%`,
        }}
      />
      {label && (
        <span
          className="absolute rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80"
          style={{ left: `calc(${rect.x * 100}% + 6px)`, top: `calc(${rect.y * 100}% + 6px)` }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
