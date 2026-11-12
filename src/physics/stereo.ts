// Beam-centred stereographic projection. A lab direction d (unit, pointing toward the gun) is drawn
// where the *beam* direction -d would project, so a zone axis appears on the same side as its Kikuchi
// pattern centre in the diffraction pattern (q = -K d_xy). Radius tan(theta/2): 90 deg -> 1.
import { Vec3 } from './linalg';

export function stereoForward(d: Vec3): [number, number] {
  const k = 1 / (1 + d[2]);
  return [-d[0] * k, -d[1] * k];
}

export function stereoInverse(p: [number, number] | number[]): Vec3 {
  const r2 = p[0] * p[0] + p[1] * p[1];
  const k = 1 / (1 + r2);
  return [-2 * p[0] * k, -2 * p[1] * k, (1 - r2) * k];
}

/** Radius on the unit stereogram for polar angle theta. */
export const stereoRadius = (theta: number) => Math.tan(theta / 2);
