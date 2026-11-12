import lobato from './data/lobato.json';

const PARAMS = lobato.params as Record<string, number[][]>;
export const SYMBOLS: string[] = lobato.symbols;
const ZMAP = new Map(SYMBOLS.map((s, i) => [s, i + 1]));

export const atomicNumber = (sym: string) => ZMAP.get(sym) ?? 0;

/** "Sr2+" -> "Sr", "O1" -> "O", "GA" -> "Ga". Returns "" if not an element. */
export function normalizeSymbol(raw: string): string {
  const m = /^([A-Za-z]{1,2})/.exec(raw.trim());
  if (!m) return '';
  let s = m[1];
  s = s[0].toUpperCase() + s.slice(1).toLowerCase();
  if (ZMAP.has(s)) return s;
  s = s[0];
  return ZMAP.has(s) ? s : '';
}

/** Electron scattering factor (A) at g = 1/d (1/A), Lobato & Van Dyck 2014. */
export function feLobato(sym: string, g: number): number {
  const p = PARAMS[sym];
  if (!p) return 0;
  const g2 = g * g;
  let f = 0;
  for (let i = 0; i < 5; i++) {
    const bg = p[1][i] * g2;
    f += (p[0][i] * (2 + bg)) / ((1 + bg) * (1 + bg));
  }
  return f;
}

// Jmol-like colours for display; anything missing falls back to a neutral pink-grey.
const COLORS: Record<string, string> = {
  H: '#ffffff', He: '#d9ffff', Li: '#cc80ff', Be: '#c2ff00', B: '#ffb5b5', C: '#909090', N: '#3050f8',
  O: '#ff0d0d', F: '#90e050', Na: '#ab5cf2', Mg: '#8aff00', Al: '#bfa6a6', Si: '#f0c8a0', P: '#ff8000',
  S: '#ffff30', Cl: '#1ff01f', K: '#8f40d4', Ca: '#3dff00', Sc: '#e6e6e6', Ti: '#bfc2c7', V: '#a6a6ab',
  Cr: '#8a99c7', Mn: '#9c7ac7', Fe: '#e06633', Co: '#f090a0', Ni: '#50d050', Cu: '#c88033', Zn: '#7d80b0',
  Ga: '#c28f8f', Ge: '#668f8f', As: '#bd80e3', Se: '#ffa100', Br: '#a62929', Sr: '#00ff00', Y: '#94ffff',
  Zr: '#94e0e0', Nb: '#73c2c9', Mo: '#54b5b5', Ru: '#248f8f', Rh: '#0a7d8c', Pd: '#006985', Ag: '#c0c0c0',
  Cd: '#ffd98f', In: '#a67573', Sn: '#668080', Sb: '#9e63b5', Te: '#d47a00', I: '#940094', Ba: '#00c900',
  La: '#70d4ff', Ce: '#ffffc7', Nd: '#c7ffc7', Gd: '#45ffc7', Hf: '#4dc2ff', Ta: '#4da6ff', W: '#2194d6',
  Re: '#267dab', Os: '#266696', Ir: '#175487', Pt: '#d0d0e0', Au: '#ffd123', Hg: '#b8b8d0', Pb: '#575961',
  Bi: '#9e4fb5', U: '#008fff',
};
export const elementColor = (sym: string) => COLORS[sym] ?? '#dd99bb';

/** Rough display radius (A), grows slowly with Z; only used for drawing spheres. */
export function displayRadius(sym: string): number {
  const z = atomicNumber(sym);
  if (z <= 1) return 0.3;
  if (z <= 10) return 0.45;
  return 0.5 + 0.25 * Math.min(1, (z - 10) / 70);
}
