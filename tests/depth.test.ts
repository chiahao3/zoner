// Session 3: depth weighting of the real-space image and the resolution metric.
// The MEP slice weight is the slice window blurred by the depth PSF, cut to the specimen [0, T]:
//   w(zeta) = box_T(zeta) * (box_dz (*) G_sigma)(zeta - z0),   D(g_z) = int w exp(-2 pi i g_z zeta)
import { describe, expect, it } from 'vitest';
import { builtinCrystal } from '../src/physics/crystal';
import { buildReflections } from '../src/physics/structure';
import { rotY, rotX, matMul } from '../src/physics/linalg';
import { TransferParams, depthWeight, depthFT, depthTransfer, passWidth, sinc } from '../src/physics/transfer';
import { imageCoefficients } from '../src/physics/image';

const DEG = Math.PI / 180;
const FWHM2SIG = 1 / 2.354820045;
const base: TransferParams = { lateralRes: 0.5, mode: 'slice', sliceThickness: 20, depthRes: 30, totalThickness: 200, sliceDepth: 100 };
const GZ = [0, 0.002, 0.005, 0.01, 0.02, 0.04, 0.08, 0.15];

describe('depth weight and its Fourier transform', () => {
  it('depth sum: exact box transform T sinc(T g) exp(-i pi g T), phase included', () => {
    const p = { ...base, mode: 'sum' as const };
    const w = depthWeight(p);
    expect(w.area).toBeCloseTo(200, 9);
    for (const g of [...GZ, 0.0123, -0.031, 1.7]) {
      const [re, im] = depthFT(w, g);
      const m = 200 * sinc(200 * g), ph = -Math.PI * g * 200;
      expect(re).toBeCloseTo(m * Math.cos(ph), 8);
      expect(im).toBeCloseTo(m * Math.sin(ph), 8);
    }
  });
  it('a slice deep inside a thick specimen reproduces the infinite-slab formula', () => {
    for (const depthRes of [0, 10, 30]) {
      const p = { ...base, totalThickness: 4000, sliceDepth: 2000, depthRes };
      const w = depthWeight(p);
      const sz = depthRes * FWHM2SIG;
      for (const g of GZ) {
        const [re, im] = depthFT(w, g);
        // remove the slice-centre phase exp(-2 pi i g z0)
        const c = Math.cos(2 * Math.PI * g * 2000), s = Math.sin(2 * Math.PI * g * 2000);
        const r0 = re * c - im * s, i0 = re * s + im * c;
        const ref = 20 * sinc(20 * g) * Math.exp(-2 * Math.PI ** 2 * sz * sz * g * g);
        // within 0.25% of the slice area: the piecewise-linear weight (5 nodes per sigma) damps
        // by sinc^2(g h) ~ 1 - (pi g h)^2 / 3, h = sigma / 5
        expect(Math.abs(r0 - ref)).toBeLessThan(0.05);
        expect(Math.abs(i0)).toBeLessThan(0.05);
      }
    }
  });
  it('a slice never smears more than the whole specimen (thin specimens stay sharp when tilted)', () => {
    for (const T of [5, 10, 20, 50, 200]) {
      for (const depthRes of [0, 30, 100]) {
        const p = { ...base, totalThickness: T, sliceDepth: T / 2, depthRes };
        const pSum = { ...p, mode: 'sum' as const };
        expect(passWidth(p)).toBeGreaterThanOrEqual(0.98 * passWidth(pSum));
      }
    }
  });
  it('thin specimen: 0.5 nm with a 3 nm depth PSF tilts like 0.5 nm, not like the PSF', () => {
    const p = { ...base, totalThickness: 5, sliceDepth: 2.5 };
    // before session 3 the slice ignored the specimen and passed only |g_z| < ~0.03 1/A
    expect(passWidth(p)).toBeGreaterThan(0.15);
  });
  it('a depth PSF much wider than the specimen turns the slice into the depth sum', () => {
    const p = { ...base, depthRes: 20000 };
    const pSum = { ...p, mode: 'sum' as const };
    for (const g of GZ) expect(Math.abs(depthTransfer(g, p) - depthTransfer(g, pSum))).toBeLessThan(0.01);
  });
  it('the part of a slice outside the specimen holds no potential', () => {
    expect(depthWeight({ ...base, depthRes: 0, sliceDepth: 0 }).area).toBeCloseTo(10, 9); // half in
    expect(depthWeight({ ...base, depthRes: 0, sliceDepth: 200 }).area).toBeCloseTo(10, 9);
    expect(depthWeight({ ...base, depthRes: 0, sliceDepth: 300 }).area).toBe(0);
    expect(depthTransfer(0.01, { ...base, depthRes: 0, sliceDepth: 300 })).toBe(0);
    // a blurred slice centred on the surface keeps about half its weight
    const a = depthWeight({ ...base, sliceDepth: 0 }).area;
    expect(a).toBeGreaterThan(9);
    expect(a).toBeLessThan(11);
  });
  it('the transform is Hermitian (real weight) and |D| <= area', () => {
    const w = depthWeight({ ...base, sliceDepth: 15 });
    for (const g of GZ) {
      const [r1, i1] = depthFT(w, g), [r2, i2] = depthFT(w, -g);
      expect(r1).toBeCloseTo(r2, 10);
      expect(i1).toBeCloseTo(-i2, 10);
      expect(Math.hypot(r1, i1)).toBeLessThanOrEqual(w.area + 1e-9);
    }
  });
});

describe('image coefficients use the finite-specimen depth weight', () => {
  const si = builtinCrystal('Si');
  const R = buildReflections(si, 2.9, 300);
  const rot = matMul(rotX(3 * DEG), rotY(5 * DEG));
  const top = (tp: TransferParams) => imageCoefficients(R, rot, si.lattice.volume, 300, tp);
  it('thin specimen, wide depth PSF: the slice image has the shape of the depth sum', () => {
    // the blurred slice holds only the fraction dz / (sqrt(2 pi) sigma) of the specimen's
    // potential (the total over all slices is conserved), so compare shapes, not scale
    const p = { ...base, totalThickness: 5, sliceDepth: 2.5, depthRes: 2000 };
    const a = top(p), b = top({ ...p, mode: 'sum' });
    expect(a.n).toBeGreaterThan(10);
    const k = a.data[2] / b.data[2];
    expect(k).toBeCloseTo(20 / (Math.sqrt(2 * Math.PI) * 2000 * FWHM2SIG), 3);
    for (let i = 0; i < 10; i++) {
      expect(a.data[4 * i] - b.data[4 * i]).toBeCloseTo(0, 6);
      expect(a.data[4 * i + 2] / b.data[4 * i + 2] / k).toBeGreaterThan(0.97);
      expect(a.data[4 * i + 2] / b.data[4 * i + 2] / k).toBeLessThan(1.03);
    }
  });
  it('a slice entirely outside the specimen gives an empty image', () => {
    expect(top({ ...base, depthRes: 0, sliceDepth: 400 }).n).toBe(0);
  });
});
