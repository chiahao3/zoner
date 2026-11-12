// Excitation errors and intensity formulas. Lab frame: x right, y up (looking from the gun),
// z toward the gun; the beam travels along -z, so k0 = (tx, ty, -sqrt(K^2 - t^2)).
import { Vec3 } from './linalg';

/** s_g = (K^2 - |k0 + g|^2) / (2K): positive when g lies inside the Ewald sphere. */
export function excitationError(g: Vec3, K: number, tx = 0, ty = 0): number {
  const kz = -Math.sqrt(K * K - tx * tx - ty * ty);
  const x = tx + g[0], y = ty + g[1], z = kz + g[2];
  return (K * K - (x * x + y * y + z * z)) / (2 * K);
}

/** Two-beam (Howie-Whelan, no absorption): I_g = sin^2(pi t s_eff) / (xi s_eff)^2, s_eff = sqrt(s^2 + 1/xi^2). */
export function twoBeamIntensity(s: number, xi: number, t: number): number {
  if (!Number.isFinite(xi)) return 0;
  const seff = Math.sqrt(s * s + 1 / (xi * xi));
  const v = Math.sin(Math.PI * t * seff) / (xi * seff);
  return v * v;
}

/** Kinematic: I_g = (pi t / xi)^2 sinc^2(pi t s). */
export function kinematicIntensity(s: number, xi: number, t: number): number {
  if (!Number.isFinite(xi)) return 0;
  const x = Math.PI * t * s;
  const sinc = Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x;
  const a = (Math.PI * t) / xi;
  return a * a * sinc * sinc;
}
