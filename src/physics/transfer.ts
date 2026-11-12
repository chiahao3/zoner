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
  sliceDepth: number; // A, centre of the slice below the entrance surface
}

const FWHM2SIG = 1 / 2.354820045;

export function sinc(x: number): number {
  const p = Math.PI * x;
  return Math.abs(p) < 1e-8 ? 1 : Math.sin(p) / p;
}

// ---- depth weight ------------------------------------------------------------------------------
// The image integrates the potential along the beam with a weight w(zeta), zeta = depth below the
// entrance surface. Depth sum: w = 1 on [0, T]. MEP slice: the slice window [z0 - dz/2, z0 + dz/2]
// blurred by the Gaussian depth PSF, and cut to the specimen: w = box_T * (box_dz (*) G)(zeta - z0).
// (The reconstruction is (V box_T) (*) G; integrating it over the slice window gives this weight.)
// A Gaussian alone, as before session 3, let a slice reach depths where there is no crystal, so a
// thin specimen smeared like the PSF width instead of like its own thickness when tilted.
// w is held as uniform piecewise-linear runs; nodes are dense only where it curves, and the
// transform of that interpolant is exact (no aliasing), so D(g_z) is right at any g_z.

/** erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** Window [lo, hi] with Gaussian-blurred edges (sigma = 0: hard edges). */
interface SoftWindow { lo: number; hi: number; sigma: number }
const softValue = (w: SoftWindow, z: number) =>
  0.5 * (erf((z - w.lo) / (Math.SQRT2 * w.sigma)) - erf((z - w.hi) / (Math.SQRT2 * w.sigma)));

export interface DepthRun { z0: number; h: number; w: Float64Array } // nodes z0 + k h, k = 0..n
export interface DepthWeight {
  runs: DepthRun[];
  /** integral of w (A): the thickness of potential that the image integrates */
  area: number;
  /** bound on the total variation of w: |D(g)| <= tv / (2 pi |g|) */
  tv: number;
}

const EDGE_SIGMAS = 4; // a blurred edge is curved within +-4 sigma
const NODES_PER_SIGMA = 5;
const MAX_RUN = 48;

/** Weight along the beam for transfer parameters p (lengths in A). */
export function depthWeight(p: TransferParams): DepthWeight {
  const T = Math.max(0, p.totalThickness);
  const wins: SoftWindow[] = [];
  if (p.mode === 'slice') {
    const half = p.sliceThickness / 2;
    wins.push({ lo: p.sliceDepth - half, hi: p.sliceDepth + half, sigma: Math.max(0, p.depthRes) * FWHM2SIG });
  }
  const soft = wins.filter((w) => w.sigma > 0), hard = wins.filter((w) => !(w.sigma > 0));
  // breakpoints: specimen surfaces, hard edges, the ends of each curved region
  const bp = [0, T];
  const curved: { a: number; b: number; h: number }[] = [];
  for (const w of hard) bp.push(w.lo, w.hi);
  for (const w of soft) {
    for (const e of [w.lo, w.hi]) {
      const c = { a: e - EDGE_SIGMAS * w.sigma, b: e + EDGE_SIGMAS * w.sigma, h: w.sigma / NODES_PER_SIGMA };
      curved.push(c);
      bp.push(c.a, c.b);
    }
  }
  const xs = [...new Set(bp.filter((x) => x >= 0 && x <= T))].sort((a, b) => a - b);
  const runs: DepthRun[] = [];
  let area = 0, tv = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1], len = b - a;
    if (!(len > 1e-9 * Math.max(1, T))) continue;
    const mid = 0.5 * (a + b);
    // hard windows are constant inside a piece; soft ones are sampled at the nodes
    let hardF = 1;
    for (const w of hard) if (mid < w.lo || mid > w.hi) hardF = 0;
    if (hardF === 0) continue;
    let h = Infinity;
    for (const c of curved) if (c.a < b && c.b > a) h = Math.min(h, c.h);
    const n = Math.min(MAX_RUN, Math.max(1, Math.ceil(len / h - 1e-9)));
    const step = len / n;
    const wv = new Float64Array(n + 1);
    let any = false;
    for (let k = 0; k <= n; k++) {
      // outside every curved region the soft factors are saturated (0 or 1): constant
      const z = h === Infinity ? mid : a + k * step;
      let v = 1;
      for (const w of soft) v *= softValue(w, z);
      if (v < 1e-9) v = 0;
      wv[k] = v;
      if (v > 0) any = true;
    }
    if (!any) continue;
    runs.push({ z0: a, h: step, w: wv });
    let s = 0, d = wv[0] + wv[n];
    for (let k = 0; k < n; k++) {
      s += wv[k] + wv[k + 1];
      d += Math.abs(wv[k + 1] - wv[k]);
    }
    area += 0.5 * step * s;
    tv += d;
  }
  return { runs, area, tv };
}

/**
 * D(g_z) = integral of w(zeta) exp(-2 pi i g_z zeta) d zeta for the piecewise-linear w: exact per
 * segment, [w_k phi1(x) + w_{k+1} phi2(x)] h exp(-2 pi i g_z zeta_k), x = 2 pi g_z h, with
 * phi1 = int_0^1 (1-t) e^{-ixt} dt and phi2 = int_0^1 t e^{-ixt} dt. Returns [re, im] (A).
 */
export function depthFT(dw: DepthWeight, gz: number): [number, number] {
  const kap = 2 * Math.PI * gz;
  let re = 0, im = 0;
  for (const r of dw.runs) {
    const x = kap * r.h;
    const cx = Math.cos(x), sx = Math.sin(x);
    let p0r: number, p0i: number, p2r: number, p2i: number;
    if (Math.abs(x) < 0.1) {
      const x2 = x * x;
      p0r = 1 - x2 / 6 + (x2 * x2) / 120 - (x2 * x2 * x2) / 5040;
      p0i = -x * (0.5 - x2 / 24 + (x2 * x2) / 720);
      p2r = 0.5 - x2 / 8 + (x2 * x2) / 144 - (x2 * x2 * x2) / 5760;
      p2i = -x * (1 / 3 - x2 / 30 + (x2 * x2) / 840);
    } else {
      p0r = sx / x;
      p0i = -(1 - cx) / x;
      const ar = p0r - cx, ai = p0i + sx;
      p2r = ai / x;
      p2i = -ar / x;
    }
    const p1r = p0r - p2r, p1i = p0i - p2i;
    // S1 = sum w_k E^k, S2 = sum w_{k+1} E^k, E = exp(-i x)
    const w = r.w, n = w.length - 1;
    let er = 1, ei = 0, s1r = 0, s1i = 0, s2r = 0, s2i = 0;
    for (let k = 0; k < n; k++) {
      s1r += w[k] * er;
      s1i += w[k] * ei;
      s2r += w[k + 1] * er;
      s2i += w[k + 1] * ei;
      const t = er * cx + ei * sx;
      ei = ei * cx - er * sx;
      er = t;
    }
    const cr = p1r * s1r - p1i * s1i + p2r * s2r - p2i * s2i;
    const ci = p1r * s1i + p1i * s1r + p2r * s2i + p2i * s2r;
    const ph = -kap * r.z0;
    const pr = Math.cos(ph) * r.h, pi = Math.sin(ph) * r.h;
    re += pr * cr - pi * ci;
    im += pr * ci + pi * cr;
  }
  return [re, im];
}

/** |D(g_z)| / D(0): the depth transfer, normalised to 1 at g_z = 0 (0 if nothing is integrated). */
export function depthTransferOf(dw: DepthWeight, gz: number): number {
  if (!(dw.area > 0)) return 0;
  const [re, im] = depthFT(dw, gz);
  return Math.hypot(re, im) / dw.area;
}
export const depthTransfer = (gz: number, p: TransferParams) => depthTransferOf(depthWeight(p), gz);

export function lateralTransfer(gperp: number, lateralRes: number): number {
  const s = lateralRes * FWHM2SIG;
  return Math.exp(-2 * Math.PI * Math.PI * s * s * gperp * gperp);
}

export const COLLINEAR_SIN = Math.sin((15 * Math.PI) / 180);
/**
 * Pass threshold shared by the lateral and depth criteria: a Gaussian PSF of FWHM w transfers
 * exp(-pi^2/(4 ln 2)) ~ 0.028 at g = 1/w. Using it for the depth transfer too (first lobe only)
 * makes the off-zone resolution equal the column smear width (t tan(theta) for a box slab, FWHM
 * tan(theta) for a Gaussian depth PSF), and the on-zone value equal the lateral FWHM.
 */
export const TAU = Math.exp(-(Math.PI ** 2) / (4 * Math.LN2));

/** ZOLZ reflection lists (indices into a ReflectionSet, descending |g|) for each low-index zone. */
export interface ZoneSet {
  zones: { uvw: Vec3; dir: Vec3; refl: Int32Array }[];
  gcut: number;
}

/**
 * For every zone (one sign each), the allowed reflections with h u + k v + l w = 0 and
 * |g| <= 1/lateralRes, Friedel halves, sorted by descending |g|.
 */
export function buildZoneSet(R: ReflectionSet, zones: { uvw: Vec3; dir: Vec3 }[], lateralRes: number): ZoneSet {
  const gcut = 1 / lateralRes;
  const seen = new Set<string>();
  const out: ZoneSet['zones'] = [];
  for (const z of zones) {
    const [u, v, w] = z.uvw;
    if (seen.has(`${-u},${-v},${-w}`)) continue;
    seen.add(`${u},${v},${w}`);
    const idx: number[] = [];
    for (let i = 0; i < R.n && R.gabs[i] <= gcut; i++) {
      if (!R.allowed[i]) continue;
      const h = R.hkl[3 * i], k = R.hkl[3 * i + 1], l = R.hkl[3 * i + 2];
      if (h * u + k * v + l * w !== 0) continue;
      if (h < 0 || (h === 0 && (k < 0 || (k === 0 && l < 0)))) continue;
      idx.push(i);
    }
    if (idx.length < 2) continue;
    idx.reverse();
    out.push({ uvw: z.uvw, dir: z.dir, refl: Int32Array.from(idx) });
  }
  return { zones: out, gcut };
}

/** Largest |s| with depth transfer still >= tau (first crossing). */
export function passWidth(p: TransferParams, tau = TAU): number {
  const dw = depthWeight(p);
  const depthTransfer = (g: number) => depthTransferOf(dw, g);
  let lo = 0, hi = 1;
  while (depthTransfer(hi) >= tau && hi < 100) hi *= 2;
  // the first crossing lies before the first zero; bracket it by scanning
  const steps = 400;
  for (let k = 1; k <= steps; k++) {
    const s = (hi * k) / steps;
    if (depthTransfer(s) < tau) {
      hi = s;
      lo = (hi * (k - 1)) / steps;
      break;
    }
  }
  for (let it = 0; it < 40; it++) {
    const m = 0.5 * (lo + hi);
    if (depthTransfer(m) >= tau) lo = m;
    else hi = m;
  }
  return lo;
}

export const N_PHI = 18; // in-plane directions sampled for the worst-direction resolution (10 deg)

/**
 * Zones farther than this from the beam cannot resolve finer than dWorst in every direction: the
 * reflections that set the worst-direction support at |g| >= 1/dWorst include one at least ~45 deg
 * from the tilt axis, whose |g.n| >= |g| sin(theta) sin(45 deg) (generous bound).
 */
export function zoneCutAngle(p: TransferParams, dWorst: number, tau = TAU): number {
  return Math.asin(Math.min(1, (passWidth(p, tau) * dWorst) / Math.SQRT1_2));
}

/**
 * Projected 2D resolution along n (crystal frame, unit), per low-index zone of the set.
 * Within a zone's ZOLZ, P = reflections with |g| <= 1/lateralRes whose |g.n| lies inside the first
 * lobe of the depth transfer above tau (|g.n| <= passWidth).
 * The image resolves direction e (in the image plane) down to 1/h(e), h(e) = max_{g in P} |g.e|;
 * the 2D resolution is the worst direction: d = 1 / min_e h(e) (e sampled every 10 deg).
 * The best zone wins. d = Infinity when nothing is within reach (d > dWorst may also read Infinity);
 * d1 = finest single fringe seen.
 */
export function resolution2D(R: ReflectionSet, n: Vec3, p: TransferParams, zs: ZoneSet, tau = TAU, dWorst = 4) {
  const sPass = passWidth(p, tau);
  const cosCut = Math.cos(zoneCutAngle(p, dWorst, tau));
  // in-plane basis
  const a: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1: Vec3 = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2: Vec3 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  const cph = Array.from({ length: N_PHI }, (_, k) => Math.cos((Math.PI * k) / N_PHI));
  const sph = Array.from({ length: N_PHI }, (_, k) => Math.sin((Math.PI * k) / N_PHI));
  const h = new Float64Array(N_PHI);
  let bestH = 0, best1 = Infinity;
  let bestZone = -1;
  for (let zi = 0; zi < zs.zones.length; zi++) {
    const z = zs.zones[zi];
    if (Math.abs(z.dir[0] * n[0] + z.dir[1] * n[1] + z.dir[2] * n[2]) < cosCut) continue;
    h.fill(0);
    let minH = 0;
    for (const i of z.refl) {
      const ga = R.gabs[i];
      if (ga <= minH || ga <= bestH) break; // later (shorter) g cannot raise the minimum further
      const gx = R.g[3 * i], gy = R.g[3 * i + 1], gz = R.g[3 * i + 2];
      const s = gx * n[0] + gy * n[1] + gz * n[2];
      if (Math.abs(s) > sPass) continue;
      best1 = Math.min(best1, 1 / ga);
      const x = gx * e1[0] + gy * e1[1] + gz * e1[2];
      const y = gx * e2[0] + gy * e2[1] + gz * e2[2];
      minH = Infinity;
      for (let k = 0; k < N_PHI; k++) {
        const v = Math.abs(x * cph[k] + y * sph[k]);
        if (v > h[k]) h[k] = v;
        if (h[k] < minH) minH = h[k];
      }
    }
    if (minH > bestH) {
      bestH = minH;
      bestZone = zi;
    }
  }
  return { d: bestH > 0 ? 1 / bestH : Infinity, d1: best1, zone: bestZone >= 0 ? zs.zones[bestZone].uvw : null };
}
