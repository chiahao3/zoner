import { describe, expect, it } from 'vitest';
import { wavelength, sigmaInteraction, gammaRel } from '../src/physics/constants';
import { feLobato, normalizeSymbol } from '../src/physics/elements';
import { Lattice } from '../src/physics/lattice';
import { builtinCrystal } from '../src/physics/crystal';
import { structureFactor, buildReflections, extinctionDistance } from '../src/physics/structure';
import { Holder, tiltToBring, mountForZone } from '../src/physics/orientation';
import { matVec, transpose, norm, dot, angleBetween, normalize } from '../src/physics/linalg';
import { enumerateZones, nearestZones, toFourIndexDir } from '../src/physics/zones';
import { twoBeamIntensity, kinematicIntensity, excitationError } from '../src/physics/diffraction';
import { blochIntensities } from '../src/physics/bloch';
import { symmetricEigen } from '../src/physics/eigen';
import { resolution2D, depthTransfer, buildZoneSet } from '../src/physics/transfer';
import { stereoForward, stereoInverse } from '../src/physics/stereo';

const DEG = Math.PI / 180;

describe('constants', () => {
  it('relativistic wavelength', () => {
    expect(wavelength(100)).toBeCloseTo(0.037014, 5);
    expect(wavelength(200)).toBeCloseTo(0.025079, 5);
    expect(wavelength(300)).toBeCloseTo(0.019687, 5);
  });
  it('interaction parameter (Kirkland) and gamma', () => {
    expect(sigmaInteraction(300)).toBeCloseTo(6.526e-4, 6);
    expect(gammaRel(200)).toBeCloseTo(1.3914, 3);
  });
});

describe('elements', () => {
  it('Lobato f_e(0) for Si and symbol normalisation', () => {
    expect(feLobato('Si', 0)).toBeCloseTo(5.836, 2);
    expect(feLobato('O', 0.5)).toBeCloseTo(1.2318, 3);
    expect(normalizeSymbol('Sr2+')).toBe('Sr');
    expect(normalizeSymbol('O1')).toBe('O');
    expect(normalizeSymbol('GA')).toBe('Ga');
  });
});

describe('lattice', () => {
  it('cubic d-spacings and reciprocal', () => {
    const L = new Lattice(5.431, 5.431, 5.431, 90, 90, 90);
    expect(L.dSpacing([2, 2, 0])).toBeCloseTo(5.431 / Math.sqrt(8), 6);
    expect(L.volume).toBeCloseTo(5.431 ** 3, 6);
  });
  it('hexagonal d(0002) = c/2 and angle a-b = 120 deg', () => {
    const L = new Lattice(3.189, 3.189, 5.185, 90, 90, 120);
    expect(L.dSpacing([0, 0, 2])).toBeCloseTo(5.185 / 2, 6);
    expect(L.dSpacing([1, 0, 0])).toBeCloseTo((3.189 * Math.sqrt(3)) / 2, 6);
    expect(angleBetween(L.dirToCart([1, 0, 0]), L.dirToCart([0, 1, 0])) / DEG).toBeCloseTo(120, 6);
    expect(L.isHexagonal).toBe(true);
  });
  it('g(hkl) is perpendicular to every direction in its zone', () => {
    const L = new Lattice(4, 5, 6, 80, 95, 110);
    expect(dot(L.hklToCart([1, -1, 2]), L.dirToCart([1, 1, 0]))).toBeCloseTo(0, 10);
  });
});

describe('structure factors', () => {
  const si = builtinCrystal('Si');
  const al = builtinCrystal('Al');
  const sto = builtinCrystal('SrTiO3');
  it('extinction rules', () => {
    expect(Math.hypot(...structureFactor(si, [2, 0, 0]))).toBeLessThan(1e-9);
    expect(Math.hypot(...structureFactor(si, [1, 1, 1]))).toBeGreaterThan(1);
    expect(Math.hypot(...structureFactor(al, [1, 0, 0]))).toBeLessThan(1e-9);
    expect(Math.hypot(...structureFactor(al, [1, 1, 0]))).toBeLessThan(1e-9);
    // STO 100 is weak but non-zero for electrons: f_Sr - f_Ti - f_O ~ 0.09 A
    expect(Math.hypot(...structureFactor(sto, [1, 0, 0]))).toBeGreaterThan(0.05);
    expect(Math.hypot(...structureFactor(sto, [1, 1, 0]))).toBeGreaterThan(5);
  });
  it('extinction distances near Williams & Carter (100 kV, no Debye-Waller)', () => {
    // W&C Table 13.1: Si 220 = 75.7 nm, Al 111 = 55.6 nm, Si 111 = 60.2 nm
    expect(extinctionDistance(si, [2, 2, 0], 100, 0) / 10).toBeGreaterThan(75.7 * 0.93);
    expect(extinctionDistance(si, [2, 2, 0], 100, 0) / 10).toBeLessThan(75.7 * 1.07);
    expect(extinctionDistance(si, [1, 1, 1], 100, 0) / 10).toBeGreaterThan(60.2 * 0.9);
    expect(extinctionDistance(si, [1, 1, 1], 100, 0) / 10).toBeLessThan(60.2 * 1.1);
    expect(extinctionDistance(al, [1, 1, 1], 100, 0) / 10).toBeGreaterThan(55.6 * 0.9);
    expect(extinctionDistance(al, [1, 1, 1], 100, 0) / 10).toBeLessThan(55.6 * 1.1);
  });
  it('reflection set excludes 000, is sorted and flags forbidden reflections', () => {
    const R = buildReflections(si, 1.2, 200);
    expect(R.n).toBeGreaterThan(50);
    for (let i = 1; i < R.n; i++) expect(R.gabs[i]).toBeGreaterThanOrEqual(R.gabs[i - 1] - 1e-12);
    const i200 = R.indexOf([2, 0, 0]);
    expect(i200).toBeGreaterThanOrEqual(0);
    expect(R.allowed[i200]).toBe(0);
    expect(R.allowed[R.indexOf([1, 1, 1])]).toBe(1);
    expect(R.indexOf([0, 0, 0])).toBe(-1);
  });
});

describe('CIF parser', async () => {
  const { parseCIF } = await import('../src/physics/cif');
  it('GaN P6_3mc from asymmetric unit + symops, with uncertainties', () => {
    const cif = `data_GaN
_cell_length_a 3.189(2)
_cell_length_b 3.189(2)
_cell_length_c 5.185
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 120
_symmetry_space_group_name_H-M 'P 63 m c'
loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'-y, x-y, z'
'-x+y, -x, z'
'-x, -y, z+1/2'
'y, -x+y, z+1/2'
'x-y, x, z+1/2'
'-y, -x, z'
'-x+y, y, z'
'x, x-y, z'
'y, x, z+1/2'
'x-y, -y, z+1/2'
'-x, -x+y, z+1/2'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Ga1 Ga3+ 0.33333 0.66667 0.0 1.0
N1 N3- 0.33333 0.66667 0.377 1.0
`;
    const c = parseCIF(cif);
    expect(c.lattice.a).toBeCloseTo(3.189, 6);
    expect(c.lattice.gamma).toBeCloseTo(120, 6);
    expect(c.sites.length).toBe(4);
    expect(c.sites.filter((s) => s.el === 'Ga').length).toBe(2);
  });
  it('P1 SrTiO3 with label-only atoms, Uiso, comments and a text field', () => {
    const cif = `# comment
data_STO
_journal_title
;
some text with _fake_tag 1 2 3
;
_cell_length_a 3.905
_cell_length_b 3.905
_cell_length_c 3.905
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_space_group_symop_operation_xyz
x,y,z
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
Sr1 0 0 0 0.0063
Ti1 0.5 0.5 0.5 0.0063
O1 0.5 0.5 0 0.0063
O2 0.5 0 0.5 0.0063
O3 0 0.5 0.5 0.0063
`;
    const c = parseCIF(cif);
    expect(c.sites.length).toBe(5);
    expect(c.sites[0].el).toBe('Sr');
    expect(c.sites[0].B).toBeCloseTo(8 * Math.PI ** 2 * 0.0063, 6);
  });
  it('centering ops are de-duplicated (bcc Fe)', () => {
    const cif = `data_Fe
_cell_length_a 2.8665
_cell_length_b 2.8665
_cell_length_c 2.8665
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_symmetry_equiv_pos_as_xyz
x,y,z
-x,-y,-z
x+1/2,y+1/2,z+1/2
-x+1/2,-y+1/2,-z+1/2
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Fe 0 0 0
`;
    expect(parseCIF(cif).sites.length).toBe(2);
  });
});

describe('orientation', () => {
  const si = builtinCrystal('Si');
  it('mountForZone puts the zone axis on +z at zero tilt', () => {
    const h = new Holder(mountForZone(si.lattice, [1, 1, 0]));
    const z = matVec(h.R(), si.lattice.dirToCartUnit([1, 1, 0]));
    expect(z[2]).toBeCloseTo(1, 10);
  });
  it('tiltToBring solves the double tilt to any reachable zone', () => {
    const h = new Holder(mountForZone(si.lattice, [0, 0, 1]));
    const target = si.lattice.dirToCartUnit([1, 1, 4]);
    const t = tiltToBring(h.mount, target);
    const h2 = new Holder(h.mount, t.alpha, t.beta);
    expect(matVec(h2.R(), target)[2]).toBeCloseTo(1, 10);
    expect(Math.abs(t.alpha)).toBeLessThan(25 * DEG);
  });
  it('beam direction in crystal frame is R^T z', () => {
    const h = new Holder(mountForZone(si.lattice, [1, 1, 1]), 3 * DEG, -2 * DEG);
    const b = h.beamCrystal();
    expect(norm(b)).toBeCloseTo(1, 12);
    const back = matVec(h.R(), b);
    expect(back[2]).toBeCloseTo(1, 12);
    expect(dot(b, matVec(transpose(h.R()), [0, 0, 1]))).toBeCloseTo(1, 12);
  });
});

describe('zones', () => {
  it('enumerates unique primitive zones and finds the nearest', () => {
    const si = builtinCrystal('Si');
    const zones = enumerateZones(si.lattice, 3);
    const keys = new Set(zones.map((z) => z.uvw.join(',')));
    expect(keys.has('2,2,0')).toBe(false);
    expect(keys.has('1,1,0')).toBe(true);
    const h = new Holder(mountForZone(si.lattice, [1, 1, 0]), 0.5 * DEG, 0);
    const near = nearestZones(h.beamCrystal(), zones, 3);
    expect(near[0].zone.uvw.join(',')).toBe('1,1,0');
    expect(near[0].angle / DEG).toBeCloseTo(0.5, 6);
  });
  it('four-index direction conversion', () => {
    expect(toFourIndexDir([1, 0, 0])).toEqual([2, -1, -1, 0]);
    expect(toFourIndexDir([0, 0, 1])).toEqual([0, 0, 0, 1]);
  });
});

describe('diffraction formulas', () => {
  it('excitation error: positive inside the Ewald sphere, zero on it', () => {
    const K = 1 / wavelength(200);
    // Beam travels -z, Ewald sphere centre at (0,0,+K) and through the origin.
    const g = 0.5;
    const onSphere = [g, 0, K - Math.sqrt(K * K - g * g)];
    expect(excitationError(onSphere, K)).toBeCloseTo(0, 9);
    expect(excitationError([g, 0, onSphere[2] + 0.01], K)).toBeGreaterThan(0);
  });
  it('two-beam reduces to kinematic for large s', () => {
    const xi = 600, t = 100, s = 0.0437; // t*s off a sinc node
    expect(twoBeamIntensity(s, xi, t) / kinematicIntensity(s, xi, t)).toBeCloseTo(1, 1);
    expect(twoBeamIntensity(0, xi, xi / 2)).toBeCloseTo(1, 10);
  });
});

describe('eigen solver', () => {
  it('diagonalises a random symmetric matrix', () => {
    const n = 7;
    const a = new Float64Array(n * n);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) a[i * n + j] = a[j * n + i] = rnd();
    const { values, vectors } = symmetricEigen(n, a.slice());
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        let av = 0;
        for (let j = 0; j < n; j++) av += a[i * n + j] * vectors[j * n + k];
        expect(av).toBeCloseTo(values[k] * vectors[i * n + k], 10);
      }
    }
  });
});

describe('Bloch wave', () => {
  const si = builtinCrystal('Si');
  const kV = 200;
  const K = 1 / wavelength(kV);
  it('two beams reproduce the analytic Pendellosung', () => {
    const xi = extinctionDistance(si, [2, 2, 0], kV, 0.5);
    const g = si.lattice.hklToCart([2, 2, 0]);
    for (const s of [0, 0.002, -0.004]) {
      // place g at excitation error s for a beam along -z
      const gl = norm(g);
      const gLab = [gl, 0, s + (gl * gl) / (2 * K)];
      const I = blochIntensities(si, [[0, 0, 0], [2, 2, 0]], [[0, 0, 0], gLab], kV, 300, 0.5);
      expect(I[1]).toBeCloseTo(twoBeamIntensity(excitationError(gLab, K), xi, 300), 5);
      expect(I[0] + I[1]).toBeCloseTo(1, 9);
    }
  });
  it('many beams conserve intensity', () => {
    const h = new Holder(mountForZone(si.lattice, [1, 1, 0]));
    const R = h.R();
    const hkls: number[][] = [[0, 0, 0]];
    // ZOLZ of [110]: h + k = 0
    for (const hkl of [[1, -1, 1], [-1, 1, -1], [1, -1, -1], [-1, 1, 1], [0, 0, 2], [0, 0, -2], [2, -2, 0], [-2, 2, 0], [1, -1, 3], [-1, 1, -3], [1, -1, -3], [-1, 1, 3]])
      hkls.push(hkl);
    const gLab = hkls.map((x) => matVec(R, si.lattice.hklToCart(x)));
    const I = blochIntensities(si, hkls, gLab, kV, 250, 0.5);
    expect(I.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    // Friedel pair and mirror (001) partners are equal on the exact zone axis
    expect(I[1]).toBeCloseTo(I[2], 8);
    expect(I[1]).toBeCloseTo(I[3], 8);
    expect(I[5]).toBeCloseTo(I[6], 8);
  });
});

describe('projected-resolution metric', () => {
  const al = builtinCrystal('Al');
  const R0 = buildReflections(al, 1 / 0.45, 300);
  const ZS = buildZoneSet(R0, enumerateZones(al.lattice, 3), 0.5);
  const zone = al.lattice.dirToCartUnit([0, 0, 1]);
  const params = { lateralRes: 0.5, mode: 'slice' as const, sliceThickness: 5, depthRes: 0, totalThickness: 200, sliceDepth: 100 };
  it('depth transfer is 1 at gz=0 and falls with gz', () => {
    expect(depthTransfer(0, params)).toBeCloseTo(1, 12);
    expect(depthTransfer(0.05, { ...params, mode: 'sum' })).toBeLessThan(0.5);
  });
  it('zone set holds only ZOLZ reflections of each zone (one sign per zone)', () => {
    const z001 = ZS.zones.find((z) => z.uvw.join(',') === '0,0,1' || z.uvw.join(',') === '0,0,-1')!;
    expect(z001).toBeDefined();
    for (const i of z001.refl) expect(R0.hkl[3 * i + 2]).toBe(0);
    expect(ZS.zones.filter((z) => z.uvw.join(',') === '0,0,-1' || z.uvw.join(',') === '0,0,1').length).toBe(1);
  });
  it('on zone the 2D resolution approaches the lateral limit', () => {
    const r = resolution2D(R0, zone, params, ZS);
    expect(r.d).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(r.d).toBeLessThan(0.65);
  });
  it('tilting off zone degrades the depth-sum resolution monotonically', () => {
    const sum = { ...params, mode: 'sum' as const };
    const at = (deg: number) => {
      const n = [Math.sin(deg * DEG), 0, Math.cos(deg * DEG)];
      return resolution2D(R0, n, sum, ZS).d;
    };
    expect(at(0)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThanOrEqual(at(2));
    // column smear picture: a fringe d is lost once T*tan(theta) exceeds ~d
    expect(at(1)).toBeGreaterThan(0.4 * 200 * Math.tan(1 * DEG));
  });
  it('off zone the depth-sum resolution matches the column smear t*tan(theta)', () => {
    // same FWHM-equivalent criterion as the lateral limit: d = smear width, not 2x it
    const sum = { ...params, mode: 'sum' as const };
    for (const deg of [0.3, 0.5]) {
      const n = [Math.sin(deg * DEG), Math.sin(0.4 * deg * DEG), Math.cos(deg * DEG)];
      const d = resolution2D(R0, normalize(n), sum, ZS).d;
      const smear = 200 * Math.tan(Math.hypot(1, 0.4) * deg * DEG);
      expect(d / smear).toBeGreaterThan(0.75);
      expect(d / smear).toBeLessThan(1.3);
    }
  });
  it('a general orientation far from low-index zones shows no fine 2D lattice', () => {
    // regression: random high-index reflections inside the thin |g.n| shell used to fake ~0.6 A
    const thick = { ...params, sliceThickness: 20, depthRes: 50 };
    const n = normalize([0.31, 0.57, 0.76]);
    expect(resolution2D(R0, n, thick, ZS).d).toBeGreaterThan(2);
  });
});

describe('stereographic projection', () => {
  it('round trips and matches the DP sense (zone tilted to +x appears at -x)', () => {
    const d = [Math.sin(10 * DEG), 0.1, Math.cos(10 * DEG)];
    const n = norm(d);
    const u = d.map((x) => x / n);
    const p = stereoForward(u);
    expect(p[0]).toBeLessThan(0);
    const back = stereoInverse(p);
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(u[i], 10);
    expect(Math.hypot(...stereoForward([1, 0, 0]))).toBeCloseTo(1, 10);
  });
});
