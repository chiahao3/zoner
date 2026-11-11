import { Mat3, Vec3, fromColumns, inv3, matVec, normalize, transpose, det3, norm } from './linalg';

const D2R = Math.PI / 180;

/**
 * Lattice in the crystal Cartesian frame: a along x, b in the xy plane.
 * A has the direct basis vectors as columns, B the reciprocal ones (no 2 pi): B = A^{-T}.
 */
export class Lattice {
  readonly A: Mat3;
  readonly B: Mat3;
  readonly Ainv: Mat3;
  readonly volume: number;
  constructor(
    readonly a: number, readonly b: number, readonly c: number,
    readonly alpha: number, readonly beta: number, readonly gamma: number,
  ) {
    const ca = Math.cos(alpha * D2R), cb = Math.cos(beta * D2R), cg = Math.cos(gamma * D2R), sg = Math.sin(gamma * D2R);
    const av: Vec3 = [a, 0, 0];
    const bv: Vec3 = [b * cg, b * sg, 0];
    const cx = c * cb;
    const cy = (c * (ca - cb * cg)) / sg;
    const cz = Math.sqrt(Math.max(c * c - cx * cx - cy * cy, 0));
    const cv: Vec3 = [cx, cy, cz];
    this.A = fromColumns(av, bv, cv);
    this.Ainv = inv3(this.A);
    this.B = transpose(this.Ainv);
    this.volume = det3(this.A);
  }
  get isHexagonal(): boolean {
    return Math.abs(this.a - this.b) < 1e-4 * this.a && Math.abs(this.gamma - 120) < 0.01 &&
      Math.abs(this.alpha - 90) < 0.01 && Math.abs(this.beta - 90) < 0.01;
  }
  dirToCart(uvw: Vec3): Vec3 {
    return matVec(this.A, uvw);
  }
  dirToCartUnit(uvw: Vec3): Vec3 {
    return normalize(matVec(this.A, uvw));
  }
  /** Cartesian vector -> fractional direction indices [uvw] (not rounded). */
  cartToDir(v: Vec3): Vec3 {
    return matVec(this.Ainv, v);
  }
  hklToCart(hkl: Vec3): Vec3 {
    return matVec(this.B, hkl);
  }
  dSpacing(hkl: Vec3): number {
    return 1 / norm(this.hklToCart(hkl));
  }
}
