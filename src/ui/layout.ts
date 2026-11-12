// Pure layout helpers (unit-tested): canvas backing-store size and stereogram tilt-ring spacing.

/** Backing-store size for a canvas of css size w x h. When capped at maxPx, both sides shrink by
 *  the same factor so the drawing keeps its aspect ratio. */
export function canvasSize(w: number, h: number, dpr: number, maxPx: number): [number, number] {
  let W = w * dpr, H = h * dpr;
  const k = Math.min(1, maxPx / Math.max(W, H, 1));
  W *= k;
  H *= k;
  return [Math.max(16, Math.round(W)), Math.max(16, Math.round(H))];
}

const RING_STEPS = [1, 2, 5, 10, 15, 20, 30];
/** Round ring spacing (deg) giving 1-3 rings inside the map half-range. */
export function ringStep(rangeDeg: number): number {
  return RING_STEPS.find((s) => rangeDeg / s <= 3) ?? 30;
}
/** Ring angles (deg) from the beam out to the furthest visible angle (below 180 deg). */
export function ringAngles(rangeDeg: number, maxVisibleDeg: number): number[] {
  const s = ringStep(rangeDeg);
  const out: number[] = [];
  for (let a = s; a <= Math.min(maxVisibleDeg, 179.9) + 1e-9; a += s) out.push(a);
  return out;
}

/** Greedy label placement: candidates in priority order (lowest zone index first); a label is
 *  placed if its box (x, y = top-left, w, h in px) stays inside the panel and does not overlap
 *  one already placed. Returns which candidates get a label. */
export function placeLabels(c: { x: number; y: number; w: number; h: number }[], W: number, H: number): boolean[] {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  return c.map((b) => {
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) return false;
    if (placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h)) return false;
    placed.push(b);
    return true;
  });
}
