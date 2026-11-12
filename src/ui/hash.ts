// Shareable state in the URL hash: non-default parameters, tilts (deg) and the holder mount.
// v=2 (0.0.2+): one convergence angle. Links without v come from 0.0.1, where convAlpha was the
// imaging aperture and the DP had its own dpIllum/dpAlpha; see migrate001.
import { Store, DEFAULTS, Params } from './state';
import { Holder } from '../physics/orientation';
import { orthonormalize, DEG } from './util';

export function encodeHash(s: Store): string {
  const q = new URLSearchParams();
  q.set('v', '2');
  for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
    if (s.p[k] !== DEFAULTS[k]) q.set(k, String(s.p[k]));
  }
  if (!q.has('crystal')) q.set('crystal', s.p.crystal);
  q.set('a', (s.holder.alpha / DEG).toFixed(3));
  q.set('b', (s.holder.beta / DEG).toFixed(3));
  q.set('m', s.holder.mount.map((x) => x.toFixed(6)).join(','));
  return '#' + q.toString();
}

/** Returns true if a state was applied. */
export function decodeHash(s: Store, hash: string): boolean {
  if (!hash || hash.length < 2) return false;
  const q = new URLSearchParams(hash.slice(1));
  if (!q.has('v')) migrate001(q);
  const crystal = q.get('crystal');
  if (crystal && s.crystalNames.includes(crystal) && crystal !== s.p.crystal) s.loadCrystal(crystal);
  for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
    if (k === 'crystal' || !q.has(k)) continue;
    const raw = q.get(k)!;
    const def = DEFAULTS[k];
    const v = typeof def === 'number' ? parseFloat(raw) : typeof def === 'boolean' ? raw === 'true' : raw;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    (s.p as unknown as Record<string, unknown>)[k] = v;
  }
  const m = q.get('m')?.split(',').map(Number);
  if (m && m.length === 9 && m.every(Number.isFinite)) s.holder = new Holder(orthonormalize(m));
  const a = parseFloat(q.get('a') ?? 'NaN'), b = parseFloat(q.get('b') ?? 'NaN');
  if (Number.isFinite(a) && Number.isFinite(b)) {
    s.holder.alpha = a * DEG;
    s.holder.beta = b * DEG;
  }
  s.emit('crystal');
  s.emit('params');
  s.emit('orientation');
  return true;
}

/** 0.0.1 -> 0.0.2: the DP convergence becomes the single convergence angle. */
function migrate001(q: URLSearchParams) {
  const illum = q.get('dpIllum');
  q.delete('convAlpha'); // was the imaging aperture, not the DP
  if (illum === 'convergent') q.set('convAlpha', q.get('dpAlpha') ?? '2');
  else if (illum === 'parallel') q.set('convAlpha', '0');
  q.delete('dpIllum');
  q.delete('dpAlpha');
}
