import { Lattice } from './lattice';
import { Vec3, matVec, norm } from './linalg';

export interface Site {
  el: string; // element symbol
  frac: Vec3; // fractional coordinates in [0,1)
  occ: number;
  B: number; // Debye-Waller B (A^2)
}

export interface Crystal {
  name: string;
  lattice: Lattice;
  sites: Site[]; // full unit cell
  note?: string;
}

const wrap = (x: number) => {
  const y = x - Math.floor(x);
  return y > 1 - 1e-6 ? 0 : y;
};

/** Add a site unless an equivalent one (same element, within tol A, periodic) exists. */
export function addUnique(lattice: Lattice, sites: Site[], s: Site, tol = 0.01): boolean {
  const f = s.frac.map(wrap);
  for (const t of sites) {
    if (t.el !== s.el) continue;
    const d = f.map((x, i) => {
      let dd = x - t.frac[i];
      dd -= Math.round(dd);
      return dd;
    });
    if (norm(matVec(lattice.A, d)) < tol) return false;
  }
  sites.push({ ...s, frac: f });
  return true;
}

const DW_DEFAULT = 0.5;
const FCC: Vec3[] = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
const BCC: Vec3[] = [[0, 0, 0], [0.5, 0.5, 0.5]];

function build(name: string, lattice: Lattice, basis: [string, Vec3][], centering: Vec3[] = [[0, 0, 0]], note?: string): Crystal {
  const sites: Site[] = [];
  for (const [el, p] of basis)
    for (const t of centering) addUnique(lattice, sites, { el, frac: [p[0] + t[0], p[1] + t[1], p[2] + t[2]], occ: 1, B: DW_DEFAULT });
  return { name, lattice, sites, note };
}

const cubic = (a: number) => new Lattice(a, a, a, 90, 90, 90);

const BUILTINS: Record<string, () => Crystal> = {
  Si: () => build('Si', cubic(5.431), [['Si', [0, 0, 0]], ['Si', [0.25, 0.25, 0.25]]], FCC, 'diamond, Fd-3m'),
  SrTiO3: () =>
    build('SrTiO3', cubic(3.905), [
      ['Sr', [0, 0, 0]], ['Ti', [0.5, 0.5, 0.5]], ['O', [0.5, 0.5, 0]], ['O', [0.5, 0, 0.5]], ['O', [0, 0.5, 0.5]],
    ], undefined, 'cubic perovskite, Pm-3m'),
  Al: () => build('Al', cubic(4.0495), [['Al', [0, 0, 0]]], FCC, 'fcc, Fm-3m'),
  Au: () => build('Au', cubic(4.0782), [['Au', [0, 0, 0]]], FCC, 'fcc, Fm-3m'),
  Cu: () => build('Cu', cubic(3.615), [['Cu', [0, 0, 0]]], FCC, 'fcc, Fm-3m'),
  GaAs: () => build('GaAs', cubic(5.6533), [['Ga', [0, 0, 0]], ['As', [0.25, 0.25, 0.25]]], FCC, 'zincblende, F-43m'),
  MgO: () => build('MgO', cubic(4.212), [['Mg', [0, 0, 0]], ['O', [0.5, 0.5, 0.5]]], FCC, 'rock salt, Fm-3m'),
  Fe: () => build('Fe', cubic(2.8665), [['Fe', [0, 0, 0]]], BCC, 'bcc alpha-Fe, Im-3m'),
  GaN: () => {
    const u = 0.377;
    return build('GaN', new Lattice(3.189, 3.189, 5.185, 90, 90, 120), [
      ['Ga', [1 / 3, 2 / 3, 0]], ['Ga', [2 / 3, 1 / 3, 0.5]], ['N', [1 / 3, 2 / 3, u]], ['N', [2 / 3, 1 / 3, 0.5 + u]],
    ], undefined, 'wurtzite, P6_3mc');
  },
};

export const BUILTIN_NAMES = Object.keys(BUILTINS);

export function builtinCrystal(name: string): Crystal {
  const f = BUILTINS[name];
  if (!f) throw new Error(`unknown crystal ${name}`);
  return f();
}

/** Default zone axis to start on for a crystal. */
export function defaultZone(c: Crystal): Vec3 {
  if (c.lattice.isHexagonal) return [1, 0, 0];
  if (c.name === 'SrTiO3' || c.name === 'Fe') return [0, 0, 1];
  return [1, 1, 0];
}

export function setDebyeWaller(c: Crystal, B: number): Crystal {
  return { ...c, sites: c.sites.map((s) => ({ ...s, B })) };
}

/** Elements in order of first appearance, with the number of sites per cell (for legends). */
export function species(c: Crystal): { el: string; n: number }[] {
  const m = new Map<string, number>();
  for (const st of c.sites) m.set(st.el, (m.get(st.el) ?? 0) + 1);
  return [...m].map(([el, n]) => ({ el, n }));
}

export function formula(c: Crystal): string {
  const counts = new Map<string, number>();
  for (const s of c.sites) counts.set(s.el, (counts.get(s.el) ?? 0) + s.occ);
  return [...counts].map(([el, n]) => `${el}${Math.abs(n - 1) < 1e-6 ? '' : +n.toFixed(2)}`).join('');
}
