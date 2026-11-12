// Session 2: pure helpers behind the UI changes (auto illumination, tilt rings, canvas sizing,
// species legend, migration of 0.0.1 links).
import { describe, expect, it } from 'vitest';
import { beamMode } from '../src/physics/diffraction';
import { wavelength } from '../src/physics/constants';
import { builtinCrystal, species } from '../src/physics/crystal';
import { canvasSize, ringStep, ringAngles, placeLabels, mradToInvA, angleUnitText, dpHoverAngle } from '../src/ui/layout';
import { holderOutline, mountForZone, tiltToBring } from '../src/physics/orientation';
import { Store, DEFAULTS, autoDepthRes, DEPTH_RES_MAX, autoLateralRes, LATERAL_RES_MAX, syncedMapRange } from '../src/ui/state';
import { decodeHash, encodeHash } from '../src/ui/hash';
import { GROUPS } from '../src/ui/controls';

const DEG = Math.PI / 180;

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

describe('session 2b: defaults and synced source', () => {
  it('rings off, holder range off, lateral 0.5 A, depth 3 nm', () => {
    expect(DEFAULTS.mapRings).toBe(false);
    expect(DEFAULTS.enforceLimits).toBe(false);
    expect(DEFAULTS.lateralRes).toBe(0.5);
    expect(DEFAULTS.depthRes).toBe(3);
  });
  it('the stereogram has no separate source: it follows the image mode', () => {
    expect('mapSource' in DEFAULTS).toBe(false);
  });
  it('no aperture-estimate buttons in the controls (session 3: only the depth resolution has an auto checkbox)', () => {
    for (const g of GROUPS) for (const c of g.ctls) if (c.key !== 'depthRes' && c.key !== 'lateralRes') expect('auto' in c).toBe(false);
  });
  it('0.0.1 links: mapSource becomes the shared image/map mode', () => {
    const s = new Store();
    decodeHash(s, '#crystal=Si&mapSource=sum&a=0&b=0');
    expect(s.p.imgMode).toBe('sum');
    const s2 = new Store();
    decodeHash(s2, '#crystal=Si&a=0&b=0'); // no explicit choice: the new default (depth sum)
    expect(s2.p.imgMode).toBe('sum');
  });
});

describe('holder range switch: engage at the stage reading', () => {
  const near = (A: number[], B: number[]) => A.every((x, i) => Math.abs(x - B[i]) < 1e-12);
  it('keeps the crystal orientation and relabels it with the stage alpha/beta', () => {
    const s = new Store();
    s.p.enforceLimits = false;
    s.setTilt(50 * DEG, -40 * DEG); // matched the pattern far outside the holder range
    const R0 = s.R();
    expect(s.engageHolder(10, -5)).toBe(true);
    expect(near(s.R(), R0)).toBe(true);
    expect(s.holder.alpha).toBeCloseTo(10 * DEG, 12);
    expect(s.holder.beta).toBeCloseTo(-5 * DEG, 12);
    expect(s.p.enforceLimits).toBe(true);
    s.setTilt(60 * DEG, 0); // now clamped at +35
    expect(s.holder.alpha).toBeCloseTo(35 * DEG, 12);
  });
  it('defaults to the current alpha/beta (no re-mount) and refuses readings beyond the range', () => {
    const s = new Store();
    s.setTilt(3 * DEG, 4 * DEG);
    const M0 = s.holder.mount.slice();
    expect(s.engageHolder()).toBe(true);
    expect(near(s.holder.mount, M0)).toBe(true);
    const s2 = new Store();
    expect(s2.engageHolder(40, 0)).toBe(false);
    expect(s2.p.enforceLimits).toBe(false);
  });
});

describe('session 2c: resolution colour scale and holder switch that always engages', () => {
  it('colour scale runs from the lateral resolution to 1.5 A (worse = not atomic, grey)', () => {
    const s = new Store();
    expect(s.dRange()).toEqual([0.5, 1.5]);
    s.p.lateralRes = 0.3;
    expect(s.dRange()).toEqual([0.3, 1.5]);
    s.p.lateralRes = 2; // a coarse setting still gets a usable range
    const [b, w] = s.dRange();
    expect(b).toBe(2);
    expect(w).toBeGreaterThan(2);
  });
  it('engages at any time: matched outside the range, the default reading is 0/0', () => {
    const s = new Store();
    s.setTilt(50 * DEG, -40 * DEG);
    const R0 = s.R();
    expect(s.defaultStageReading()).toEqual([0, 0]);
    expect(s.engageHolder()).toBe(true);
    expect(s.R().every((x, i) => Math.abs(x - R0[i]) < 1e-12)).toBe(true);
    expect(s.holder.alpha).toBeCloseTo(0, 12);
    expect(s.p.enforceLimits).toBe(true);
  });
  it('inside the range the default reading is the current alpha/beta', () => {
    const s = new Store();
    s.setTilt(12 * DEG, -3 * DEG);
    const [a, b] = s.defaultStageReading();
    expect(a).toBeCloseTo(12, 9);
    expect(b).toBeCloseTo(-3, 9);
  });
  it('re-engaging while on re-anchors at the new reading', () => {
    const s = new Store();
    s.engageHolder(0, 0);
    s.setTilt(20 * DEG, 0);
    const R0 = s.R();
    expect(s.engageHolder(5, 5)).toBe(true);
    expect(s.R().every((x, i) => Math.abs(x - R0[i]) < 1e-12)).toBe(true);
    expect(s.holder.alpha).toBeCloseTo(5 * DEG, 12);
  });
});

describe('session 2d: stereogram labels follow the zone index limit', () => {
  it('every candidate that does not collide gets a label, whatever its index', () => {
    const c = [
      { x: 0, y: 0, w: 30, h: 12 },
      { x: 100, y: 0, w: 50, h: 12 }, // high index, far away: labelled
      { x: 10, y: 4, w: 30, h: 12 }, // collides with the first: skipped
      { x: 0, y: 40, w: 60, h: 12 },
    ];
    expect(placeLabels(c, 400, 400)).toEqual([true, true, false, true]);
  });
  it('earlier candidates (lower index) win collisions, and labels stay inside the panel', () => {
    expect(placeLabels([{ x: 0, y: 0, w: 30, h: 12 }, { x: 0, y: 0, w: 30, h: 12 }], 400, 400)).toEqual([true, false]);
    expect(placeLabels([{ x: 390, y: 50, w: 30, h: 12 }], 400, 400)).toEqual([false]);
  });
});

describe('session 2d: holder range outline', () => {
  it('outline directions sit on the edge of the alpha/beta rectangle', () => {
    const L = builtinCrystal('Si').lattice;
    const M = mountForZone(L, [1, 1, 0]);
    const aL = 35 * DEG, bL = 30 * DEG;
    const pts = holderOutline(M, aL, bL, 16);
    expect(pts.length).toBe(64);
    for (const c of pts) {
      const t = tiltToBring(M, c);
      const onEdge = Math.abs(Math.abs(t.alpha) - aL) < 1e-9 || Math.abs(Math.abs(t.beta) - bL) < 1e-9;
      expect(onEdge).toBe(true);
      expect(Math.abs(t.alpha)).toBeLessThanOrEqual(aL + 1e-9);
      expect(Math.abs(t.beta)).toBeLessThanOrEqual(bL + 1e-9);
    }
  });
});

describe('auto depth resolution (lambda / alpha^2)', () => {
  it('lambda / alpha^2 in nm, rounded to 0.01 nm', () => {
    expect(autoDepthRes(300, 25)).toBeCloseTo(wavelength(300) / 0.025 ** 2 / 10, 2);
    expect(autoDepthRes(300, 25)).toBe(3.15);
    expect(autoDepthRes(300, 3)).toBeCloseTo(218.75, 1);
  });
  it('alpha = 0 (parallel beam) has no depth resolution: capped at the maximum', () => {
    expect(autoDepthRes(300, 0)).toBe(DEPTH_RES_MAX);
    expect(autoDepthRes(300, 0.01)).toBe(DEPTH_RES_MAX);
  });
  it('off by default; the 3 nm default is unchanged', () => {
    expect(DEFAULTS.depthAuto).toBe(false);
    expect(new Store().p.depthRes).toBe(3);
  });
  it('checking it fills the depth resolution from kV and alpha, which then keep it updated', () => {
    const s = new Store();
    s.set('convAlpha', 25);
    expect(s.p.depthRes).toBe(3);
    s.set('depthAuto', true);
    expect(s.p.depthRes).toBe(autoDepthRes(300, 25));
    s.set('convAlpha', 20);
    expect(s.p.depthRes).toBe(autoDepthRes(300, 20));
    s.set('kV', 200);
    expect(s.p.depthRes).toBe(autoDepthRes(200, 20));
    expect(s.p.depthAuto).toBe(true);
  });
  it('typing a depth resolution unchecks it and keeps the typed value', () => {
    const s = new Store();
    s.set('depthAuto', true);
    s.set('depthRes', 5);
    expect(s.p.depthAuto).toBe(false);
    expect(s.p.depthRes).toBe(5);
    s.set('convAlpha', 30);
    expect(s.p.depthRes).toBe(5);
  });
  it('links keep the auto setting', () => {
    const a = new Store();
    a.set('convAlpha', 22);
    a.set('depthAuto', true);
    const b = new Store();
    decodeHash(b, encodeHash(a));
    expect(b.p.depthAuto).toBe(true);
    expect(b.p.convAlpha).toBe(22);
    expect(b.p.depthRes).toBe(autoDepthRes(300, 22));
  });
  it('the depth-resolution control carries the auto checkbox and accepts the capped value', () => {
    const ctl = GROUPS.flatMap((g) => g.ctls).find((c) => c.key === 'depthRes')!;
    expect(ctl.auto?.key).toBe('depthAuto');
    expect(ctl.max).toBeGreaterThanOrEqual(DEPTH_RES_MAX);
  });
});

describe('session 4: collection angle, detector range, derived 1/A, DP hover, lambda/beta, map FOV sync', () => {
  const K = 1 / wavelength(300);
  it('defaults: collection angle 90 mrad; detector range, lambda/beta and map sync off', () => {
    expect(DEFAULTS.collAngle).toBe(90);
    expect(DEFAULTS.dpDetector).toBe(false);
    expect(DEFAULTS.lateralAuto).toBe(false);
    expect(DEFAULTS.mapSyncDP).toBe(false);
  });
  it('angles in mrad convert to 1/A as theta * K, shown in parentheses', () => {
    expect(mradToInvA(3, 300)).toBeCloseTo(3e-3 * K, 12);
    expect(mradToInvA(90, 300)).toBeCloseTo(4.571, 3);
    expect(angleUnitText(3, 300)).toBe('mrad (0.152 Å⁻¹)');
    expect(angleUnitText(90, 300)).toBe('mrad (4.57 Å⁻¹)');
    expect(angleUnitText(0, 300)).toBe('mrad (0 Å⁻¹)');
  });
  it('the convergence and collection fields carry the derived 1/A text (and stay in mrad)', () => {
    const ctls = GROUPS.flatMap((g) => g.ctls);
    for (const k of ['convAlpha', 'collAngle'] as const) {
      const c = ctls.find((x) => x.key === k)!;
      expect(c.unit).toBe('mrad');
      expect(c.derived?.({ ...DEFAULTS })).toMatch(/^mrad \([\d.]+ Å⁻¹\)$/);
    }
  });
  it('lambda / beta in A (0.001 A), beta = 0 capped', () => {
    expect(autoLateralRes(300, 90)).toBe(0.219);
    expect(autoLateralRes(300, 90)).toBeCloseTo(wavelength(300) / 0.09, 3);
    expect(autoLateralRes(300, 0)).toBe(LATERAL_RES_MAX);
  });
  it('lambda / beta checkbox: fills, follows kV and the collection angle, a typed value unchecks it', () => {
    const s = new Store();
    s.set('lateralAuto', true);
    expect(s.p.lateralRes).toBe(autoLateralRes(300, 90));
    s.set('collAngle', 60);
    expect(s.p.lateralRes).toBe(autoLateralRes(300, 60));
    s.set('kV', 200);
    expect(s.p.lateralRes).toBe(autoLateralRes(200, 60));
    s.set('lateralRes', 0.4);
    expect(s.p.lateralAuto).toBe(false);
    s.set('collAngle', 30);
    expect(s.p.lateralRes).toBe(0.4);
    const ctl = GROUPS.flatMap((g) => g.ctls).find((c) => c.key === 'lateralRes')!;
    expect(ctl.auto?.key).toBe('lateralAuto');
  });
  it('links keep lambda / beta, the collection angle, the detector range and the map sync', () => {
    const a = new Store();
    a.set('collAngle', 120);
    a.set('lateralAuto', true);
    a.set('dpDetector', true);
    a.set('mapSyncDP', true);
    const b = new Store();
    decodeHash(b, encodeHash(a));
    expect(b.p.collAngle).toBe(120);
    expect(b.p.lateralAuto).toBe(true);
    expect(b.p.lateralRes).toBe(autoLateralRes(300, 120));
    expect(b.p.dpDetector).toBe(true);
    expect(b.p.mapSyncDP).toBe(true);
    expect(b.p.mapRange).toBeCloseTo(syncedMapRange(b.p.dpRange, b.K), 12);
  });
  it('map FOV sync: the map half-range equals the DP half-width, asin(q / K)', () => {
    expect(syncedMapRange(2.2, K)).toBeCloseTo(Math.asin(2.2 / K) / DEG, 12);
    const s = new Store();
    s.set('mapSyncDP', true);
    expect(s.p.mapRange).toBeCloseTo(syncedMapRange(DEFAULTS.dpRange, s.K), 12);
    s.set('dpRange', 5);
    expect(s.p.mapRange).toBeCloseTo(syncedMapRange(5, s.K), 12);
    s.set('kV', 120);
    expect(s.p.mapRange).toBeCloseTo(syncedMapRange(5, s.K), 12);
    s.set('mapRange', 30); // choosing a map range by hand ends the sync
    expect(s.p.mapSyncDP).toBe(false);
    expect(s.p.mapRange).toBe(30);
  });
  it('DP hover: the angle from the beam of a Kikuchi centre at q, in deg, mrad and 1/A', () => {
    const q: [number, number] = [K * Math.sin(1 * DEG) * 0.6, K * Math.sin(1 * DEG) * 0.8];
    const h = dpHoverAngle(q, K);
    expect(h.deg).toBeCloseTo(1, 10);
    expect(h.mrad).toBeCloseTo(1000 * DEG, 10);
    expect(h.invA).toBeCloseTo(K * Math.sin(1 * DEG), 10);
  });
  it('rings: fine steps for small (synced) ranges, labels without float noise', () => {
    expect(ringStep(2.5)).toBe(1);
    expect(ringStep(1.2)).toBe(0.5);
    expect(ringStep(0.5)).toBe(0.2);
    expect(ringAngles(0.5, 0.75)).toEqual([0.2, 0.4, 0.6]);
    expect(ringAngles(0.25, 0.4)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});
