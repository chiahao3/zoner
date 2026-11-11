// Minimal CIF reader: cell, symmetry operators (xyz form), atom sites. Enough for COD / ICSD /
// Materials Project / VESTA exports. Space-group symbols alone are not expanded (no tables).
import { Lattice } from './lattice';
import { Crystal, Site, addUnique } from './crystal';
import { normalizeSymbol } from './elements';

type Loop = { tags: string[]; rows: string[][] };

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.startsWith(';')) {
      // multi-line text field
      const buf = [line.slice(1)];
      while (++li < lines.length && !lines[li].startsWith(';')) buf.push(lines[li]);
      tokens.push(buf.join('\n'));
      continue;
    }
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '#') break;
      if (ch === "'" || ch === '"') {
        // quote ends at a matching quote followed by whitespace / end of line
        let j = i + 1;
        while (j < line.length && !(line[j] === ch && (j + 1 === line.length || /\s/.test(line[j + 1])))) j++;
        tokens.push(line.slice(i + 1, j));
        i = j + 1;
        continue;
      }
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j++;
      tokens.push(line.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

function parseBlocks(text: string): { items: Map<string, string>; loops: Loop[] } {
  const t = tokenize(text);
  const items = new Map<string, string>();
  const loops: Loop[] = [];
  let i = 0;
  let seenData = false;
  while (i < t.length) {
    const tok = t[i];
    const low = tok.toLowerCase();
    if (low.startsWith('data_')) {
      if (seenData) break; // first data block only
      seenData = true;
      i++;
    } else if (low === 'loop_') {
      i++;
      const tags: string[] = [];
      while (i < t.length && t[i].startsWith('_')) tags.push(t[i++].toLowerCase());
      const vals: string[] = [];
      while (i < t.length && !t[i].startsWith('_') && t[i].toLowerCase() !== 'loop_' && !t[i].toLowerCase().startsWith('data_'))
        vals.push(t[i++]);
      const rows: string[][] = [];
      for (let r = 0; r + tags.length <= vals.length; r += tags.length) rows.push(vals.slice(r, r + tags.length));
      loops.push({ tags, rows });
    } else if (tok.startsWith('_')) {
      items.set(low, t[i + 1] ?? '');
      i += 2;
    } else i++;
  }
  return { items, loops };
}

/** "5.431(2)" -> 5.431; "?" / "." -> NaN */
export function cifNumber(s: string | undefined): number {
  if (s === undefined) return NaN;
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.trim());
  return m ? parseFloat(m[0]) : NaN;
}

type Op = { rot: number[][]; tr: number[] };

/** Parse "x-y, -y+1/2, z+0.25" into a rotation part and translation. */
export function parseSymop(s: string): Op {
  const parts = s.replace(/\s+/g, '').toLowerCase().split(',');
  if (parts.length !== 3) throw new Error(`bad symop "${s}"`);
  const rot: number[][] = [];
  const tr: number[] = [];
  for (const p of parts) {
    const row = [0, 0, 0];
    let t = 0;
    const re = /([+-]?)(\d*\.?\d*(?:\/\d+)?)\*?([xyz]?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p)) && m[0].length) {
      const sign = m[1] === '-' ? -1 : 1;
      const numStr = m[2];
      let num = 1;
      if (numStr) {
        if (numStr.includes('/')) {
          const [a, b] = numStr.split('/');
          num = parseFloat(a) / parseFloat(b);
        } else num = parseFloat(numStr);
      }
      if (m[3]) row['xyz'.indexOf(m[3])] += sign * num;
      else t += sign * num;
    }
    rot.push(row);
    tr.push(t);
  }
  return { rot, tr };
}

const findLoop = (loops: Loop[], tag: string) => loops.find((l) => l.tags.includes(tag));

export function parseCIF(text: string, nameHint = ''): Crystal {
  const { items, loops } = parseBlocks(text);
  const num = (k: string) => cifNumber(items.get(k));
  const a = num('_cell_length_a'), b = num('_cell_length_b'), c = num('_cell_length_c');
  const al = num('_cell_angle_alpha'), be = num('_cell_angle_beta'), ga = num('_cell_angle_gamma');
  if (![a, b, c, al, be, ga].every(Number.isFinite)) throw new Error('CIF: missing cell parameters');
  const lattice = new Lattice(a, b, c, al, be, ga);

  const opTags = ['_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz', '_space_group_symop.operation_xyz'];
  let ops: Op[] = [];
  let note = '';
  for (const tag of opTags) {
    const l = findLoop(loops, tag);
    if (l) {
      const k = l.tags.indexOf(tag);
      ops = l.rows.map((r) => parseSymop(r[k]));
      break;
    }
  }
  const sg = items.get('_symmetry_space_group_name_h-m') ?? items.get('_space_group_name_h-m_alt') ?? '';
  if (!ops.length) {
    ops = [parseSymop('x,y,z')];
    if (sg && sg.replace(/\s/g, '').toUpperCase() !== 'P1')
      note = `no symmetry operators in file (space group "${sg}"); treated as P1, structure may be incomplete`;
  }

  const atomLoop = findLoop(loops, '_atom_site_fract_x');
  if (!atomLoop) throw new Error('CIF: no _atom_site_fract_x loop');
  const col = (t: string) => atomLoop.tags.indexOf(t);
  const iType = col('_atom_site_type_symbol'), iLabel = col('_atom_site_label');
  const ix = col('_atom_site_fract_x'), iy = col('_atom_site_fract_y'), iz = col('_atom_site_fract_z');
  const iOcc = col('_atom_site_occupancy'), iU = col('_atom_site_u_iso_or_equiv'), iB = col('_atom_site_b_iso_or_equiv');

  const sites: Site[] = [];
  for (const r of atomLoop.rows) {
    const el = normalizeSymbol(iType >= 0 ? r[iType] : r[iLabel]) || normalizeSymbol(r[iLabel] ?? '');
    if (!el) continue;
    const f = [cifNumber(r[ix]), cifNumber(r[iy]), cifNumber(r[iz])];
    if (!f.every(Number.isFinite)) continue;
    const occ = iOcc >= 0 && Number.isFinite(cifNumber(r[iOcc])) ? cifNumber(r[iOcc]) : 1;
    let B = 0.5;
    if (iU >= 0 && Number.isFinite(cifNumber(r[iU]))) B = 8 * Math.PI ** 2 * cifNumber(r[iU]);
    else if (iB >= 0 && Number.isFinite(cifNumber(r[iB]))) B = cifNumber(r[iB]);
    if (!(B > 0) || B > 10) B = 0.5;
    for (const op of ops) {
      const p = op.rot.map((row, i) => row[0] * f[0] + row[1] * f[1] + row[2] * f[2] + op.tr[i]);
      addUnique(lattice, sites, { el, frac: p, occ, B });
    }
  }
  if (!sites.length) throw new Error('CIF: no atoms parsed');
  const name = items.get('_chemical_formula_sum')?.replace(/\s+/g, '') || nameHint || 'CIF';
  return { name, lattice, sites, note: note || (sg ? `CIF, ${sg}` : 'CIF') };
}
