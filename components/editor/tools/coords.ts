import { editorRuntime } from "../editorRuntime";

export type DisplayRect = { left: number; top: number; width: number; height: number };

/** Client point → frame px, using the last preview view and the displayed canvas rect. */
export function clientToFrame(clientX: number, clientY: number, container: HTMLElement, rect: DisplayRect): [number, number] | null {
  const v = editorRuntime.view;
  if (!v) return null;
  const b = container.getBoundingClientRect();
  const rx = ((clientX - b.left - rect.left) / rect.width) * v.width;
  const ry = ((clientY - b.top - rect.top) / rect.height) * v.height;
  return [v.originX + rx / v.scale, v.originY + ry / v.scale];
}

/** CSS px per frame px for the current display. */
export function cssPerFrame(rect: DisplayRect): number {
  const v = editorRuntime.view;
  return v ? (rect.width / v.width) * v.scale : 1;
}

/** Frame px → CSS px within the canvas container. */
export function frameToCss(x: number, y: number, rect: DisplayRect): [number, number] {
  const v = editorRuntime.view;
  if (!v) return [0, 0];
  const k = cssPerFrame(rect);
  return [rect.left + (x - v.originX) * k, rect.top + (y - v.originY) * k];
}
