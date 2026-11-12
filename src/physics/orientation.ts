// Double-tilt holder model. Crystal Cartesian -> lab: R = Rx(alpha) Ry(beta) Mount.
// alpha tilts about the holder rod (lab x); the beta axis is carried by alpha (as on a real
// double-tilt holder). Lab: x right, y up (seen from the gun), z toward the gun, beam along -z.
import { Mat3, Vec3, matMul, matVec, rotX, rotY, rotZ, transpose, normalize, cross, dot, sub, scale, norm, orthonormalize } from './linalg';
import { Lattice } from './lattice';

export class Holder {
  constructor(public mount: Mat3, public alpha = 0, public beta = 0) {}
  R(): Mat3 {
    return matMul(rotX(this.alpha), matMul(rotY(this.beta), this.mount));
  }
  /** Crystal-frame unit vector currently pointing at the gun (+z lab): the zone-axis direction. */
  beamCrystal(): Vec3 {
    return matVec(transpose(this.R()), [0, 0, 1]);
  }
  clone(): Holder {
    return new Holder(this.mount.slice(), this.alpha, this.beta);
  }
  /** Rotate the specimen on the holder about the holder z axis (in-plane rotation). */
  rotateInPlane(t: number) {
    this.mount = orthonormalize(matMul(rotZ(t), this.mount));
  }
}

/** Tilts (alpha, beta) that bring the crystal direction u (Cartesian, unit) onto +z for this mount. */
export function tiltToBring(mount: Mat3, u: Vec3): { alpha: number; beta: number } {
  const v = normalize(matVec(mount, u));
  return { alpha: Math.asin(Math.max(-1, Math.min(1, v[1]))), beta: Math.atan2(-v[0], v[2]) };
}

/**
 * Mount that puts zone [uvw] on +z at zero tilt. The in-plane reference is the crystal axis
 * (c, then b, then a) most perpendicular to the zone, projected and pointed along +y (screen up).
 */
export function mountForZone(L: Lattice, uvw: Vec3, inPlane = 0): Mat3 {
  const z = L.dirToCartUnit(uvw);
  const cands = [L.dirToCartUnit([0, 0, 1]), L.dirToCartUnit([0, 1, 0]), L.dirToCartUnit([1, 0, 0])];
  let best = cands[0], bestDot = 2;
  for (const c of cands) {
    const d = Math.abs(dot(c, z));
    if (d < bestDot - 1e-6) {
      bestDot = d;
      best = c;
    }
  }
  const y = normalize(sub(best, scale(z, dot(best, z))));
  const x = cross(y, z);
  const M = [...x, ...y, ...z]; // rows: crystal -> lab
  return inPlane ? matMul(rotZ(inPlane), M) : M;
}

/** Nearest rotation taking lab direction a to lab direction b (both unit). */
export function rotationAtoB(a: Vec3, b: Vec3): Mat3 {
  const ax = cross(a, b);
  const s = norm(ax);
  const c = dot(a, b);
  if (s < 1e-12) return c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const [x, y, z] = scale(ax, 1 / s);
  const C = 1 - c;
  return [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ];
}
