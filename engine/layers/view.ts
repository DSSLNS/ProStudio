/**
 * A render "view": which part of frame space is being rendered, at what scale.
 * Preview: the crop window at preview scale. Export: one tile at scale 1.
 */
export interface View {
  /** Frame px at render pixel (0,0). */
  originX: number;
  originY: number;
  /** Render px per frame px. */
  scale: number;
  /** Render target size in px. */
  width: number;
  height: number;
}

export function viewKey(v: View): string {
  return `${v.originX.toFixed(3)},${v.originY.toFixed(3)},${v.scale.toFixed(6)},${v.width}x${v.height}`;
}

export function frameToRender(v: View, x: number, y: number): [number, number] {
  return [(x - v.originX) * v.scale, (y - v.originY) * v.scale];
}

export function renderToFrame(v: View, x: number, y: number): [number, number] {
  return [x / v.scale + v.originX, y / v.scale + v.originY];
}

/** Apply the frame→render transform to a 2D context. */
export function applyView(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, v: View) {
  ctx.setTransform(v.scale, 0, 0, v.scale, -v.originX * v.scale, -v.originY * v.scale);
}

/** Expand a view by `margin` frame px on every side (for blur/feather context). */
export function expandView(v: View, marginFrame: number): { view: View; padPx: number } {
  const padPx = Math.ceil(marginFrame * v.scale);
  return {
    view: {
      originX: v.originX - padPx / v.scale,
      originY: v.originY - padPx / v.scale,
      scale: v.scale,
      width: v.width + 2 * padPx,
      height: v.height + 2 * padPx,
    },
    padPx,
  };
}
