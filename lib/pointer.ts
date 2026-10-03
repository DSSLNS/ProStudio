/** setPointerCapture throws for pointers the browser does not track (e.g. some stylus/synthetic events); never let that abort a gesture. */
export function capturePointer(e: { currentTarget: EventTarget | null; pointerId: number }) {
  try {
    (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
  } catch {
    /* capture is an optimisation only */
  }
}
