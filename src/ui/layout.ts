// Pure layout helpers (unit-tested): canvas backing-store size, stereogram tilt-ring spacing, and
// the angle readouts (mrad <-> 1/A, DP hover).
import { wavelength } from '../physics/constants';

/** Backing-store size for a canvas of css size w x h. When capped at maxPx, both sides shrink by
 *  the same factor so the drawing keeps its aspect ratio. */
export function canvasSize(w: number, h: number, dpr: number, maxPx: number): [number, number] {
  let W = w * dpr, H = h * dpr;
  const k = Math.min(1, maxPx / Math.max(W, H, 1));
  W *= k;
  H *= k;
  return [Math.max(16, Math.round(W)), Math.max(16, Math.round(H))];
}

const RING_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30]; // sub-degree steps for a map synced to the DP
/** Round ring spacing (deg) giving 1-3 rings inside the map half-range. */
export function ringStep(rangeDeg: number): number {
  return RING_STEPS.find((s) => rangeDeg / s <= 3) ?? 30;
}
/** Ring angles (deg) from the beam out to the furthest visible angle (below 180 deg). */
export function ringAngles(rangeDeg: number, maxVisibleDeg: number): number[] {
  const s = ringStep(rangeDeg);
  const out: number[] = [];
  for (let k = 1; k * s <= Math.min(maxVisibleDeg, 179.9) + 1e-9; k++) out.push(Math.round(k * s * 1e9) / 1e9);
  return out;
}

/** Scattering angle (mrad) as a reciprocal distance q = theta K (1/A), as the DP draws disks. */
export const mradToInvA = (mrad: number, kV: number) => (mrad * 1e-3) / wavelength(kV);
/** Unit text for an angle field: "mrad (0.152 A^-1)". */
export function angleUnitText(mrad: number, kV: number): string {
  const q = mradToInvA(mrad, kV);
  return `mrad (${q === 0 ? '0' : q.toFixed(q < 1 ? 3 : 2)} Å⁻¹)`;
}
/** DP hover: the direction whose Kikuchi centre sits at q (1/A) is theta = asin(|q| / K) from the
 *  beam; returned in deg and mrad, with |q| in 1/A. */
export function dpHoverAngle(q: [number, number], K: number): { deg: number; mrad: number; invA: number } {
  const invA = Math.hypot(q[0], q[1]);
  const th = Math.asin(Math.min(1, invA / K));
  return { deg: (th * 180) / Math.PI, mrad: th * 1e3, invA };
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
