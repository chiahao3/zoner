// Session 2: pure helpers behind the UI changes (auto illumination, tilt rings, canvas sizing,
// species legend, migration of 0.0.1 links).
import { describe, expect, it } from 'vitest';
import { beamMode } from '../src/physics/diffraction';
import { wavelength } from '../src/physics/constants';
import { builtinCrystal, species } from '../src/physics/crystal';
import { canvasSize, ringStep, ringAngles } from '../src/ui/layout';
import { Store, DEFAULTS } from '../src/ui/state';
import { decodeHash, encodeHash } from '../src/ui/hash';

describe('automatic parallel / convergent illumination', () => {
  const K = 1 / wavelength(300);
  it('alpha = 0 is parallel', () => {
    expect(beamMode(0, K, 100, 3).cbed).toBe(false);
    expect(beamMode(0, K, 100, 3).rd).toBe(0);
  });
  it('disks smaller than the spot blur are drawn as spots', () => {
    // 0.5 mrad at 300 kV: rd = 0.0254 1/A -> 2.5 px at 100 px per 1/A, spot sigma 3 px
    expect(beamMode(0.5, K, 100, 3).cbed).toBe(false);
  });
  it('the default 3 mrad gives disks at the default magnification', () => {
    const m = beamMode(3, K, 100, 3);
    expect(m.cbed).toBe(true);
    expect(m.rd).toBeCloseTo(3e-3 * K, 9);
  });
  it('zooming in turns small disks into CBED disks', () => {
    expect(beamMode(0.5, K, 100, 3).cbed).toBe(false);
    expect(beamMode(0.5, K, 1000, 3).cbed).toBe(true);
  });
  it('the default convergence angle is 3 mrad and there is one entry for it', () => {
    expect(DEFAULTS.convAlpha).toBe(3);
    expect('dpAlpha' in DEFAULTS).toBe(false);
    expect('dpIllum' in DEFAULTS).toBe(false);
  });
});

describe('stereogram tilt rings', () => {
  it('2-3 rings across the half-range, round steps', () => {
    for (const r of [3, 5, 10, 20, 30, 45, 60, 90]) {
      const s = ringStep(r);
      expect([1, 2, 5, 10, 15, 20, 30]).toContain(s);
      expect(r / s).toBeLessThanOrEqual(3);
      expect(r / s).toBeGreaterThanOrEqual(1);
    }
    expect(ringStep(30)).toBe(10);
    expect(ringStep(20)).toBe(10);
  });
  it('rings run to the furthest visible angle and stop below 180 deg', () => {
    expect(ringAngles(30, 41)).toEqual([10, 20, 30, 40]);
    expect(ringAngles(90, 179)).toEqual([30, 60, 90, 120, 150]);
  });
});

describe('canvas sizing keeps the aspect ratio when capped', () => {
  it('uncapped: css size x dpr', () => {
    expect(canvasSize(400, 300, 2, 1024)).toEqual([800, 600]);
  });
  it('capped: both sides shrink by the same factor', () => {
    const [w, h] = canvasSize(1000, 500, 2, 1100);
    expect(w).toBe(1100);
    expect(h).toBe(550);
  });
  it('never below 16 px', () => {
    expect(canvasSize(2, 2, 1, 1024)).toEqual([16, 16]);
  });
});

describe('species legend', () => {
  it('lists each element once, in site order, with counts per cell', () => {
    expect(species(builtinCrystal('SrTiO3'))).toEqual([
      { el: 'Sr', n: 1 },
      { el: 'Ti', n: 1 },
      { el: 'O', n: 3 },
    ]);
    expect(species(builtinCrystal('Si'))).toEqual([{ el: 'Si', n: 8 }]);
  });
});

describe('0.0.1 links', () => {
  it('convergent dpAlpha becomes the single convergence angle', () => {
    const s = new Store();
    decodeHash(s, '#crystal=Si&dpIllum=convergent&dpAlpha=8&a=0&b=0');
    expect(s.p.convAlpha).toBe(8);
  });
  it('parallel illumination becomes alpha = 0', () => {
    const s = new Store();
    decodeHash(s, '#crystal=Si&dpIllum=parallel&convAlpha=20&a=0&b=0');
    expect(s.p.convAlpha).toBe(0);
  });
  it('0.0.1 links without dpIllum get the new default; their imaging convAlpha is dropped', () => {
    const s = new Store();
    decodeHash(s, '#crystal=Si&thickness=30&convAlpha=20&a=1&b=2&m=1,0,0,0,1,0,0,0,1');
    expect(s.p.convAlpha).toBe(3);
    expect(s.p.thickness).toBe(30);
  });
  it('new links round trip and are not treated as old ones', () => {
    const s = new Store();
    s.p.convAlpha = 5;
    s.p.imgMode = 'slice';
    const h = encodeHash(s);
    const s2 = new Store();
    decodeHash(s2, h);
    expect(s2.p.convAlpha).toBe(5);
    expect(s2.p.imgMode).toBe('slice');
    const s3 = new Store();
    decodeHash(s3, encodeHash(new Store()));
    expect(s3.p.convAlpha).toBe(3);
  });
});
