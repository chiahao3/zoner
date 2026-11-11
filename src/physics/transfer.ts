// Transfer of a crystal reflection g into a projected image. With n the beam (zone) direction,
// g_z = g.n is the reflection's distance from the zero-Laue plane. Integrating the potential over a
// slab of thickness t multiplies V_g by t sinc(t g_z) (sinc(x) = sin(pi x)/(pi x)); a Gaussian depth
// PSF (FWHM depthRes) multiplies by exp(-2 pi^2 sigma_z^2 g_z^2); a Gaussian lateral PSF (FWHM
// lateralRes) by exp(-2 pi^2 sigma^2 g_perp^2). Tilt therefore smears a column over t*tan(theta),
// which is the same statement as a fringe of spacing d disappearing once t g_z ~ 1.
import { ReflectionSet } from './structure';
import { Vec3 } from './linalg';

export type TransferMode = 'slice' | 'sum';
export interface TransferParams {
  lateralRes: number; // A, FWHM
  mode: TransferMode;
  sliceThickness: number; // A
  depthRes: number; // A, FWHM of the depth PSF (0 = none)
  totalThickness: number; // A
}

const FWHM2SIG = 1 / 2.354820045;

export function sinc(x: number): number {
  const p = Math.PI * x;
  return Math.abs(p) < 1e-8 ? 1 : Math.sin(p) / p;
}

/** Signed depth transfer, normalised to 1 at g_z = 0. */
export function depthTransferSigned(gz: number, p: TransferParams): number {
  if (p.mode === 'sum') return sinc(p.totalThickness * gz);
  const sz = p.depthRes * FWHM2SIG;
  return sinc(p.sliceThickness * gz) * Math.exp(-2 * Math.PI * Math.PI * sz * sz * gz * gz);
}
export const depthTransfer = (gz: number, p: TransferParams) => Math.abs(depthTransferSigned(gz, p));

export function lateralTransfer(gperp: number, lateralRes: number): number {
  const s = lateralRes * FWHM2SIG;
  return Math.exp(-2 * Math.PI * Math.PI * s * s * gperp * gperp);
}

export const COLLINEAR_SIN = Math.sin((15 * Math.PI) / 180);

/**
 * Finest 2D lattice resolved in the projected image along n (crystal frame, unit):
 * the largest |g| such that two non-collinear allowed reflections with |g| <= 1/lateralRes both keep
 * depth transfer >= tau. d = 1/|g2|; d1 = finest single fringe. Infinity when nothing qualifies.
 */
export function resolution2D(R: ReflectionSet, n: Vec3, p: TransferParams, tau = 0.5) {
  const gcut = 1 / p.lateralRes;
  let i1 = -1, i2 = -1;
  let p1x = 0, p1y = 0, p1z = 0, p1n = 0;
  for (let i = R.n - 1; i >= 0; i--) {
    if (R.gabs[i] > gcut || !R.allowed[i]) continue;
    const gx = R.g[3 * i], gy = R.g[3 * i + 1], gz = R.g[3 * i + 2];
    const s = gx * n[0] + gy * n[1] + gz * n[2];
    if (depthTransfer(s, p) < tau) continue;
    const px = gx - s * n[0], py = gy - s * n[1], pz = gz - s * n[2];
    const pn = Math.hypot(px, py, pz);
    if (i1 < 0) {
      i1 = i;
      p1x = px; p1y = py; p1z = pz; p1n = pn;
      continue;
    }
    const cx = p1y * pz - p1z * py, cy = p1z * px - p1x * pz, cz = p1x * py - p1y * px;
    if (Math.hypot(cx, cy, cz) > COLLINEAR_SIN * p1n * pn) {
      i2 = i;
      break;
    }
  }
  return {
    d: i2 >= 0 ? 1 / R.gabs[i2] : Infinity,
    d1: i1 >= 0 ? 1 / R.gabs[i1] : Infinity,
    i1, i2,
  };
}
