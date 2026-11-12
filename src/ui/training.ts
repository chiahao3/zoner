// Training mode: start a few degrees off a low-index zone with only the DP visible; tilt (mouse or
// arrow keys) until any zone of the allowed index set is within tolerance.
import { Store } from './state';
import { mountForZone, Holder } from '../physics/orientation';
import { nearestZones, htmlDir, Zone } from '../physics/zones';
import { rotZ, matMul, DEG } from './util';

export type Level = 'easy' | 'medium' | 'hard';
export const LEVELS: Record<Level, { maxIdx: number; off: [number, number]; tol: number; kikuchi: number; label: string }> = {
  easy: { maxIdx: 1, off: [1.5, 3], tol: 0.5, kikuchi: 0.7, label: 'Easy: ≤1 index, 1.5–3° off, Kikuchi on, ±0.5°' },
  medium: { maxIdx: 2, off: [3, 6], tol: 0.25, kikuchi: 0.6, label: 'Medium: ≤2 index, 3–6° off, Kikuchi on, ±0.25°' },
  hard: { maxIdx: 2, off: [5, 10], tol: 0.15, kikuchi: 0, label: 'Hard: ≤2 index, 5–10° off, spots only, ±0.15°' },
};

export class Trainer {
  active = false;
  level: Level = 'easy';
  t0 = 0;
  solved: { zone: Zone; time: number } | null = null;
  hint = false;
  private saved: Partial<Store['p']> = {};
  private savedHolder: Holder | null = null;

  constructor(private store: Store, private onChange: () => void) {}

  private candidates(maxIdx: number): Zone[] {
    return this.store.zones().filter((z) => Math.max(...z.uvw.map(Math.abs)) <= maxIdx);
  }

  begin(level: Level) {
    const s = this.store;
    if (!this.active) {
      this.saved = { kikuchi: s.p.kikuchi, dpLabels: s.p.dpLabels, dpIllum: s.p.dpIllum, dpTheory: s.p.dpTheory };
      this.savedHolder = s.holder.clone();
    }
    this.active = true;
    this.level = level;
    this.solved = null;
    this.hint = false;
    const L = LEVELS[level];
    const cands = this.candidates(L.maxIdx).filter((z) => z.uvw.some((x) => x !== 0));
    const target = cands[Math.floor(Math.random() * cands.length)];
    const mount = matMul(rotZ(Math.random() * 2 * Math.PI), mountForZone(s.crystal.lattice, target.uvw));
    s.holder = new Holder(mount);
    s.p.kikuchi = L.kikuchi;
    s.p.dpIllum = 'parallel';
    if (s.p.dpTheory === 'bloch') s.p.dpTheory = 'twobeam';
    // random offset that is not already near another candidate zone
    for (let tries = 0; tries < 50; tries++) {
      const th = (L.off[0] + Math.random() * (L.off[1] - L.off[0])) * DEG;
      const ph = Math.random() * 2 * Math.PI;
      s.holder.alpha = th * Math.cos(ph);
      s.holder.beta = th * Math.sin(ph);
      const near = nearestZones(s.beamCrystal(), this.candidates(L.maxIdx), 1)[0];
      if (near.angle > 1.2 * DEG) break;
    }
    this.t0 = performance.now();
    document.body.classList.add('training');
    document.body.classList.toggle('training-nohint', true);
    s.emit('params');
    s.emit('orientation');
    this.onChange();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    Object.assign(this.store.p, this.saved);
    if (this.savedHolder) this.store.holder = this.savedHolder;
    document.body.classList.remove('training', 'training-nohint');
    this.store.emit('params');
    this.store.emit('orientation');
    this.onChange();
  }

  toggleHint() {
    this.hint = !this.hint;
    document.body.classList.toggle('training-nohint', !this.hint);
    this.store.emit('params');
  }

  /** Call after every orientation change. */
  check() {
    if (!this.active || this.solved) return;
    const L = LEVELS[this.level];
    const near = nearestZones(this.store.beamCrystal(), this.candidates(L.maxIdx), 1)[0];
    if (near && near.angle < L.tol * DEG) {
      const time = (performance.now() - this.t0) / 1000;
      this.solved = { zone: near.zone, time };
      try {
        const k = `zoner.best.${this.level}`;
        const best = parseFloat(localStorage.getItem(k) ?? 'Infinity');
        if (time < best) localStorage.setItem(k, String(time));
      } catch {
        /* storage unavailable */
      }
      this.onChange();
    }
  }

  best(level: Level): number {
    try {
      return parseFloat(localStorage.getItem(`zoner.best.${level}`) ?? 'NaN');
    } catch {
      return NaN;
    }
  }

  status(): string {
    if (!this.active) return '';
    const s = this.store;
    if (this.solved) return `On zone ${htmlDir(s.crystal.lattice, this.solved.zone.uvw)} in ${this.solved.time.toFixed(1)} s`;
    return `${((performance.now() - this.t0) / 1000).toFixed(1)} s`;
  }
}
