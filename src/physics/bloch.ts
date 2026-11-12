// Many-beam Bloch-wave intensities (forward scattering, no absorption, surface normal along the beam).
// psi(t) = exp(i pi t A / K) e_0 with A_gg = 2 K s_g and A_gh = U_{g-h}.
// The complex Hermitian A is embedded as the real symmetric M = [[Ar, -Ai], [Ai, Ar]] so a single
// real eigen-solver serves both centrosymmetric and non-centrosymmetric crystals:
// x(t) = cos(cM) x0 + J sin(cM) x0, J = [[0,-1],[1,0]], c = pi t / K.
import { Crystal, setDebyeWaller } from './crystal';
import { UgComplex, ReflectionSet } from './structure';
import { wavelength } from './constants';
import { excitationError } from './diffraction';
import { Vec3, Mat3 } from './linalg';
import { symmetricEigen } from './eigen';

export function blochIntensities(
  crystal: Crystal, hkls: number[][], gLab: number[][], kV: number, thickness: number,
  B?: number, tx = 0, ty = 0,
): Float64Array {
  const c = B === undefined ? crystal : setDebyeWaller(crystal, B);
  const N = hkls.length;
  const K = 1 / wavelength(kV);
  const ucache = new Map<string, [number, number]>();
  const U = (h: number[]) => {
    const key = h.join(',');
    let u = ucache.get(key);
    if (!u) {
      u = UgComplex(c, h as Vec3, kV);
      ucache.set(key, u);
    }
    return u;
  };
  const Ar = new Float64Array(N * N), Ai = new Float64Array(N * N);
  let maxIm = 0;
  for (let i = 0; i < N; i++) {
    Ar[i * N + i] = i === 0 ? 0 : 2 * K * excitationError(gLab[i], K, tx, ty);
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const d = [hkls[i][0] - hkls[j][0], hkls[i][1] - hkls[j][1], hkls[i][2] - hkls[j][2]];
      const [re, im] = U(d);
      Ar[i * N + j] = re;
      Ai[i * N + j] = im;
      maxIm = Math.max(maxIm, Math.abs(im));
    }
  }
  const cfac = (Math.PI * thickness) / K;
  const I = new Float64Array(N);
  if (maxIm < 1e-12) {
    // Real symmetric: x(t) = V e^{i c L} V^T e0
    const { values, vectors } = symmetricEigen(N, Ar);
    for (let i = 0; i < N; i++) {
      let re = 0, im = 0;
      for (let k = 0; k < N; k++) {
        const w = vectors[i * N + k] * vectors[k]; // V_ik V_0k
        re += w * Math.cos(cfac * values[k]);
        im += w * Math.sin(cfac * values[k]);
      }
      I[i] = re * re + im * im;
    }
    return I;
  }
  const M2 = 2 * N;
  const M = new Float64Array(M2 * M2);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const ar = Ar[i * N + j], ai = Ai[i * N + j];
      M[i * M2 + j] = ar;
      M[(i + N) * M2 + j + N] = ar;
      M[i * M2 + j + N] = -ai;
      M[(i + N) * M2 + j] = ai;
    }
  const { values, vectors } = symmetricEigen(M2, M);
  // x0 = e_0 (real part 1 on beam 0) -> coefficients V^T x0 = row 0 of V
  const cosv = new Float64Array(M2), sinv = new Float64Array(M2);
  for (let k = 0; k < M2; k++) {
    const a = vectors[k]; // V_0k
    cosv[k] = a * Math.cos(cfac * values[k]);
    sinv[k] = a * Math.sin(cfac * values[k]);
  }
  const xc = new Float64Array(M2), xs = new Float64Array(M2);
  for (let i = 0; i < M2; i++) {
    let a = 0, b = 0;
    for (let k = 0; k < M2; k++) {
      a += vectors[i * M2 + k] * cosv[k];
      b += vectors[i * M2 + k] * sinv[k];
    }
    xc[i] = a;
    xs[i] = b;
  }
  // x = xc + J xs ; J [p; q] = [-q; p]
  for (let i = 0; i < N; i++) {
    const re = xc[i] - xs[i + N];
    const im = xc[i + N] + xs[i];
    I[i] = re * re + im * im;
  }
  return I;
}

export interface BlochBeams {
  idx: number[]; // indices into the ReflectionSet (beam 0 = transmitted, not included here)
}

/**
 * Pick the beams most strongly coupled to the incident one: smallest |s_g| first (weighted by |g| so
 * the low orders win ties), within gmax and |s| <= sMax. Forbidden reflections are kept (double diffraction).
 */
export function selectBlochBeams(
  R: ReflectionSet, rot: Mat3, K: number, maxBeams: number, gmax: number, sMax: number,
): number[] {
  const cand: { i: number; w: number }[] = [];
  for (let i = 0; i < R.n; i++) {
    if (R.gabs[i] > gmax) break;
    const gx = R.g[3 * i], gy = R.g[3 * i + 1], gz = R.g[3 * i + 2];
    const g: Vec3 = [
      rot[0] * gx + rot[1] * gy + rot[2] * gz,
      rot[3] * gx + rot[4] * gy + rot[5] * gz,
      rot[6] * gx + rot[7] * gy + rot[8] * gz,
    ];
    const s = Math.abs(excitationError(g, K));
    if (s > sMax) continue;
    cand.push({ i, w: s * (1 + R.gabs[i]) + 0.002 * R.gabs[i] });
  }
  cand.sort((a, b) => a.w - b.w);
  return cand.slice(0, maxBeams - 1).map((c) => c.i);
}
