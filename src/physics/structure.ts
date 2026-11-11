import { Crystal, setDebyeWaller } from './crystal';
import { feLobato } from './elements';
import { gammaRel, wavelength, VOLT_A2 } from './constants';
import { Vec3, norm } from './linalg';

/** Structure factor F_g = sum_j occ_j f_e,j(g) exp(-B_j g^2/4) exp(-2 pi i h.x_j)  (A). Returns [re, im]. */
export function structureFactor(c: Crystal, hkl: Vec3): [number, number] {
  const g = norm(c.lattice.hklToCart(hkl));
  let re = 0, im = 0;
  const fcache = new Map<string, number>();
  for (const s of c.sites) {
    const key = s.el + ':' + s.B;
    let f = fcache.get(key);
    if (f === undefined) {
      f = feLobato(s.el, g) * Math.exp((-s.B * g * g) / 4);
      fcache.set(key, f);
    }
    const ph = 2 * Math.PI * (hkl[0] * s.frac[0] + hkl[1] * s.frac[1] + hkl[2] * s.frac[2]);
    re += s.occ * f * Math.cos(ph);
    im -= s.occ * f * Math.sin(ph);
  }
  return [re, im];
}

/** Sum of |f| over the cell at g (the value F would have if every atom scattered in phase). */
function inPhaseSum(c: Crystal, g: number): number {
  let t = 0;
  for (const s of c.sites) t += s.occ * feLobato(s.el, g) * Math.exp((-s.B * g * g) / 4);
  return t;
}

/** U_g = gamma F_g / (pi Omega)  (1/A^2), complex. */
export function UgComplex(c: Crystal, hkl: Vec3, kV: number): [number, number] {
  const [re, im] = structureFactor(c, hkl);
  const k = gammaRel(kV) / (Math.PI * c.lattice.volume);
  return [re * k, im * k];
}

/** Two-beam extinction distance xi_g = K / |U_g|  (A). Optional B overrides every site's Debye-Waller factor. */
export function extinctionDistance(c: Crystal, hkl: Vec3, kV: number, B?: number): number {
  const cc = B === undefined ? c : setDebyeWaller(c, B);
  const [re, im] = UgComplex(cc, hkl, kV);
  return 1 / wavelength(kV) / Math.hypot(re, im);
}

/** Every reflection with 0 < |g| <= gmax, sorted by |g|, in the crystal Cartesian frame. */
export interface ReflectionSet {
  n: number;
  gmax: number;
  hkl: Int16Array; // 3n
  g: Float64Array; // 3n, crystal Cartesian (1/A)
  gabs: Float64Array;
  Fre: Float64Array; // structure factor (A)
  Fim: Float64Array;
  U: Float64Array; // |U_g| (1/A^2)
  V: Float64Array; // |V_g| (V)
  xi: Float64Array; // extinction distance (A)
  allowed: Uint8Array; // |F| > 2% of the in-phase sum
  indexOf(hkl: Vec3): number;
}

export const MAX_REFLECTIONS = 40000;

export function buildReflections(c: Crystal, gmaxReq: number, kV: number, maxCount = MAX_REFLECTIONS): ReflectionSet {
  const L = c.lattice;
  // Keep the list bounded for big cells: N ~ 4/3 pi g^3 Omega.
  const est = (4 / 3) * Math.PI * gmaxReq ** 3 * L.volume;
  const gmax = est > maxCount ? Math.cbrt((maxCount * 3) / (4 * Math.PI * L.volume)) : gmaxReq;
  const hmax = Math.floor(gmax * L.a), kmax = Math.floor(gmax * L.b), lmax = Math.floor(gmax * L.c);
  const tmp: { hkl: Vec3; g: Vec3; gabs: number }[] = [];
  for (let h = -hmax; h <= hmax; h++)
    for (let k = -kmax; k <= kmax; k++)
      for (let l = -lmax; l <= lmax; l++) {
        if (!h && !k && !l) continue;
        const g = L.hklToCart([h, k, l]);
        const ga = norm(g);
        if (ga <= gmax) tmp.push({ hkl: [h, k, l], g, gabs: ga });
      }
  tmp.sort((a, b) => a.gabs - b.gabs || a.hkl[0] - b.hkl[0] || a.hkl[1] - b.hkl[1] || a.hkl[2] - b.hkl[2]);
  const n = tmp.length;
  const R: ReflectionSet = {
    n, gmax,
    hkl: new Int16Array(3 * n), g: new Float64Array(3 * n), gabs: new Float64Array(n),
    Fre: new Float64Array(n), Fim: new Float64Array(n), U: new Float64Array(n), V: new Float64Array(n),
    xi: new Float64Array(n), allowed: new Uint8Array(n),
    indexOf: () => -1,
  };
  const K = 1 / wavelength(kV);
  const uk = gammaRel(kV) / (Math.PI * L.volume);
  const vk = VOLT_A2 / L.volume;
  const map = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const t = tmp[i];
    R.hkl.set(t.hkl, 3 * i);
    R.g.set(t.g, 3 * i);
    R.gabs[i] = t.gabs;
    const [re, im] = structureFactor(c, t.hkl);
    R.Fre[i] = re;
    R.Fim[i] = im;
    const F = Math.hypot(re, im);
    R.U[i] = F * uk;
    R.V[i] = F * vk;
    R.xi[i] = R.U[i] > 0 ? K / R.U[i] : Infinity;
    R.allowed[i] = F > 0.02 * inPhaseSum(c, t.gabs) ? 1 : 0;
    map.set(t.hkl.join(','), i);
  }
  R.indexOf = (hkl: Vec3) => map.get(hkl.join(',')) ?? -1;
  return R;
}
