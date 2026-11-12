// Fourier coefficients of the real-space phase image (pure, so it can be tested without WebGL).
// phi(x, y) = sigma * sum_g V_g * L(g_perp) * D(g_z) * exp(2 pi i g_perp . r), with
//   depth sum : D = T sinc(T g_z) exp(-i pi g_z T)          (slab from depth 0 to T)
//   MEP slice : D = dz sinc(dz g_z) exp(-2 pi^2 sz^2 g_z^2) exp(-2 pi i g_z z0)
// Lab z points to the gun, so depth zeta is z = -zeta. Exact for a perfect crystal slab; this is
// where tilt-induced column smearing (t tan(theta)) comes from.
import { ReflectionSet } from './structure';
import { Mat3 } from './linalg';
import { sigmaInteraction, VOLT_A2 } from './constants';
import { TransferParams, lateralTransfer, sinc } from './transfer';

export const MAX_COEF = 4096;

/**
 * Coefficients in the lab frame, [gx, gy, amplitude (rad), phase] per entry, Friedel halves
 * (amplitudes x2), strongest first, capped at maxCoef.
 * rot: crystal -> lab rotation; volume: unit-cell volume (A^3); tp: lengths in A.
 */
export function imageCoefficients(R: ReflectionSet, rot: Mat3, volume: number, kV: number, tp: TransferParams, maxCoef = MAX_COEF): { data: Float32Array; n: number } {
  const sig = sigmaInteraction(kV);
  const vk = (VOLT_A2 / volume) * sig * 2;
  const T = tp.totalThickness, dz = tp.sliceThickness, z0 = tp.sliceDepth;
  const sz = tp.depthRes / 2.354820045;
  const list: number[][] = [];
  let amax = 0;
  for (let i = 0; i < R.n; i++) {
    const h = R.hkl[3 * i], k = R.hkl[3 * i + 1], l = R.hkl[3 * i + 2];
    if (h < 0 || (h === 0 && (k < 0 || (k === 0 && l < 0)))) continue; // Friedel half
    const gx = R.g[3 * i], gy = R.g[3 * i + 1], gzc = R.g[3 * i + 2];
    const ax = rot[0] * gx + rot[1] * gy + rot[2] * gzc;
    const ay = rot[3] * gx + rot[4] * gy + rot[5] * gzc;
    const az = rot[6] * gx + rot[7] * gy + rot[8] * gzc;
    const lat = lateralTransfer(Math.hypot(ax, ay), tp.lateralRes);
    if (lat < 1e-4) continue;
    let dm: number, dph: number;
    if (tp.mode === 'sum') {
      dm = T * sinc(T * az);
      dph = -Math.PI * az * T;
    } else {
      dm = dz * sinc(dz * az) * Math.exp(-2 * Math.PI * Math.PI * sz * sz * az * az);
      dph = -2 * Math.PI * az * z0;
    }
    const amp = vk * lat * dm;
    const a = Math.abs(amp) * Math.hypot(R.Fre[i], R.Fim[i]);
    if (a < 1e-7) continue;
    const ph = Math.atan2(R.Fim[i], R.Fre[i]) + dph + (amp < 0 ? Math.PI : 0);
    list.push([ax, ay, a, ph]);
    amax = Math.max(amax, a);
  }
  const kept = list.filter((c) => c[2] > amax * 1e-4).sort((a, b) => b[2] - a[2]).slice(0, maxCoef);
  const data = new Float32Array(4 * Math.max(1, kept.length));
  kept.forEach((c, i) => data.set(c, 4 * i));
  return { data, n: kept.length };
}
