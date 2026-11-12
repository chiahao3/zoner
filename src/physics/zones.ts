import { Lattice } from './lattice';
import { Vec3, angleBetween, gcd3, norm, gcd } from './linalg';

export interface Zone {
  uvw: Vec3;
  dir: Vec3; // unit, crystal Cartesian
  len: number; // |u a + v b + w c| (A): short = "strong" zone
}

/** All primitive [uvw] with |indices| <= maxIdx (both signs), sorted by lattice-vector length. */
export function enumerateZones(L: Lattice, maxIdx: number): Zone[] {
  const out: Zone[] = [];
  for (let u = -maxIdx; u <= maxIdx; u++)
    for (let v = -maxIdx; v <= maxIdx; v++)
      for (let w = -maxIdx; w <= maxIdx; w++) {
        if (gcd3(u, v, w) !== 1) continue;
        const r = L.dirToCart([u, v, w]);
        const len = norm(r);
        out.push({ uvw: [u, v, w], dir: r.map((x) => x / len), len });
      }
  out.sort((a, b) => a.len - b.len);
  return out;
}

export interface NearZone {
  zone: Zone;
  angle: number; // rad
}

export function nearestZones(beamCrystal: Vec3, zones: Zone[], k: number, maxLen = Infinity): NearZone[] {
  const r: NearZone[] = [];
  for (const z of zones) if (z.len <= maxLen) r.push({ zone: z, angle: angleBetween(beamCrystal, z.dir) });
  r.sort((a, b) => a.angle - b.angle);
  return r.slice(0, k);
}

/** Three-index direction [uvw] -> four-index [UVTW] (hexagonal), reduced to integers. */
export function toFourIndexDir(uvw: Vec3): number[] {
  const [u, v, w] = uvw;
  const q = [2 * u - v, 2 * v - u, -(u + v), 3 * w];
  const g = gcd(gcd(q[0], q[1]), gcd(q[2], q[3])) || 1;
  return q.map((x) => x / g + 0);
}

/** Planes (hkl) -> (hkil). */
export const toFourIndexPlane = (hkl: Vec3) => [hkl[0], hkl[1], -(hkl[0] + hkl[1]), hkl[2]];

/** Index string with overbars for negatives, compact when every index is a single digit. */
export function fmtIdx(ix: number[]): string {
  const compact = ix.every((x) => Math.abs(x) < 10);
  const parts = ix.map((x) => (x < 0 ? `${-x}\u0305` : `${x}`));
  return compact ? parts.join('') : parts.join(' ');
}
/** Index list to display (four-index for hexagonal lattices). */
export const dirIdx = (L: Lattice, uvw: Vec3) => (L.isHexagonal ? toFourIndexDir(uvw) : uvw.map((x) => x + 0));
export const planeIdx = (L: Lattice, hkl: Vec3) => (L.isHexagonal ? toFourIndexPlane(hkl) : hkl.map((x) => x + 0));

/** HTML with overlines for negative indices. */
export function htmlIdx(ix: number[], open = '[', close = ']'): string {
  const sep = ix.every((x) => Math.abs(x) < 10) ? '' : ' ';
  return open + ix.map((x) => (x < 0 ? `<span class="ob">${-x}</span>` : `${x}`)).join(sep) + close;
}
export const htmlDir = (L: Lattice, uvw: Vec3) => htmlIdx(dirIdx(L, uvw));

export function fmtDir(L: Lattice, uvw: Vec3): string {
  return L.isHexagonal ? `[${fmtIdx(toFourIndexDir(uvw))}]` : `[${fmtIdx(uvw)}]`;
}
export function fmtPlane(L: Lattice, hkl: Vec3): string {
  return L.isHexagonal ? `${fmtIdx(toFourIndexPlane(hkl))}` : `${fmtIdx(hkl)}`;
}
