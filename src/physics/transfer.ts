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
  let lo = 0, hi = 1;
  while (depthTransfer(hi, p) >= tau && hi < 100) hi *= 2;
  // the first crossing lies before the first zero; bracket it by scanning
  const steps = 400;
  for (let k = 1; k <= steps; k++) {
    const s = (hi * k) / steps;
    if (depthTransfer(s, p) < tau) {
      hi = s;
      lo = (hi * (k - 1)) / steps;
      break;
    }
  }
  for (let it = 0; it < 40; it++) {
    const m = 0.5 * (lo + hi);
    if (depthTransfer(m, p) >= tau) lo = m;
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
