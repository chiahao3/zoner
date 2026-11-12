import './style.css';
import { Store } from './ui/state';
import { Controls } from './ui/controls';
import { attachPointer } from './ui/input';
import { Trainer, LEVELS, Level } from './ui/training';
import { encodeHash, decodeHash } from './ui/hash';
import { DPView } from './render/dpView';
import { ImageView } from './render/imageView';
import { StereoView } from './render/stereoView';
import { CrystalView } from './render/crystalView';
import { parseCIF } from './physics/cif';
import { formula } from './physics/crystal';
import { nearestZones, htmlDir } from './physics/zones';
import { tiltToBring } from './physics/orientation';
import { resolution2D, TAU } from './physics/transfer';
import { el, fmt, DEG, axisAngle, Vec3, matVec, angleBetween } from './ui/util';
import { stereoForward } from './physics/stereo';

const store = new Store();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------------------------
// layout
function panel(id: string, title: string, tools: HTMLElement[] = [], kind: 'gl' | 'html' = 'gl') {
  const ph = el('div', { class: 'ph' }, el('span', { class: 'pt', text: title }), el('span', { class: 'tools' }, ...tools));
  const stage = el('div', { class: 'stage' });
  if (kind === 'gl') {
    stage.append(el('canvas', { class: 'gl', id: `${id}-gl` }), el('canvas', { class: 'ov', id: `${id}-ov` }), el('div', { class: 'lbl', id: `${id}-lbl` }));
    stage.append(el('div', { class: 'veil', text: 'hidden in training' }));
  }
  const p = el('section', { class: `panel panel-${id}`, id: `panel-${id}` }, ph, stage);
  return p;
}
const btn = (text: string, title = '', cls = 'mini') => el('button', { class: cls, text, title });

const v3dBtns = [btn('Beam', 'look down the beam'), btn('Side', 'look across the beam'), btn('Oblique')];
const grid = $('grid');
grid.append(
  panel('dp', 'Diffraction'),
  panel('map', 'Resolution stereogram'),
  panel('r3d', 'Real space', v3dBtns),
  panel('sum', 'Depth sum (projected phase)'),
  panel('slice', 'MEP slice'),
  panel('info', 'Orientation', [], 'html'),
);
$('panel-info').querySelector('.stage')!.append(el('div', { id: 'info' }));
const controls = new Controls(store, $('side'));

const dp = new DPView(store, $('dp-gl'), $('dp-ov'));
const map = new StereoView(store, $('map-gl'), $('map-ov'));
const r3d = new CrystalView(store, $('r3d-gl'), $('r3d-lbl'));
const imSum = new ImageView(store, 'sum', $('sum-gl'), $('sum-ov'));
const imSlice = new ImageView(store, 'slice', $('slice-gl'), $('slice-ov'));
const views = [dp, map, r3d, imSum, imSlice];
let infoDirty = true;

const trainer = new Trainer(store, () => {
  renderTrainingUI();
  infoDirty = true;
});

// ---------------------------------------------------------------------------------------------
// state -> views
function markAll() {
  for (const v of views) v.dirty = true;
  infoDirty = true;
}
let hashTimer = 0;
store.subscribe((kinds) => {
  markAll();
  if (kinds.has('orientation')) trainer.check();
  if (kinds.has('params') || kinds.has('crystal')) controls.refresh();
  if (kinds.has('crystal')) syncCrystalSelect();
  if (!trainer.active) {
    clearTimeout(hashTimer);
    hashTimer = window.setTimeout(() => {
      history.replaceState(null, '', encodeHash(store));
      saveLocal();
    }, 300);
  }
});
dp.onNeedRender = () => (infoDirty = true);
new ResizeObserver(markAll).observe(grid);

// ---------------------------------------------------------------------------------------------
// interaction
const endInteraction = () => {
  map.lowRes = false;
  markAll();
};
attachPointer($('dp-ov'), store, {
  onDrag: (x, y, px, py, e) => {
    if (e.shiftKey) {
      const r = $('dp-ov').getBoundingClientRect();
      const a0 = Math.atan2(-(py - r.height / 2), px - r.width / 2), a1 = Math.atan2(-(y - r.height / 2), x - r.width / 2);
      store.rotateInPlane(a1 - a0);
    } else dp.drag(dp.toQ(px, py), dp.toQ(x, y));
  },
  onRightDrag: (dx, dy) => {
    const sc = dp.scale();
    dp.pan = [dp.pan[0] - dx / sc, dp.pan[1] + dy / sc];
    dp.dirty = true;
  },
  onWheel: (dy) => store.set('dpRange', +Math.min(15, Math.max(0.15, store.p.dpRange * Math.exp(dy * 0.001))).toFixed(3)),
  onDbl: () => goNearest(),
}, endInteraction);

attachPointer($('map-ov'), store, {
  onDrag: (x, y, px, py) => {
    map.lowRes = true;
    map.drag(map.toP(px, py), map.toP(x, y));
  },
  onClick: (x, y) => {
    const hit = map.hits.find((h) => Math.hypot(h.x - x, h.y - y) < 8);
    if (hit) animateToDir(hit.zone.dir);
  },
  onDbl: (x, y) => {
    const P = map.toP(x, y);
    if (P[0] ** 2 + P[1] ** 2 < 1) animateToDir(map.crystalDirAt(P));
  },
  onWheel: (dy) => {
    const opts = [3, 5, 10, 20, 30, 45, 60, 90];
    const i = opts.indexOf(store.p.mapRange);
    const j = Math.max(0, Math.min(opts.length - 1, (i < 0 ? 4 : i) + (dy > 0 ? 1 : -1)));
    store.set('mapRange', opts[j]);
  },
}, endInteraction);

/** Trackball: the object follows the pointer (screen y up). */
const trackball = (x: number, y: number, px: number, py: number) => {
  const dx = x - px, dy = -(y - py);
  const ang = Math.hypot(dx, dy) * 0.25 * DEG;
  if (ang > 0) store.applyLabRotation(axisAngle([-dy, dx, 0], ang));
};
attachPointer($('r3d-ov'), store, {
  onDrag: trackball,
  onRightDrag: (dx, dy) => r3d.orbit(dx, dy),
  onWheel: (dy) => {
    r3d.zoom = Math.max(0.2, Math.min(8, r3d.zoom * Math.exp(-dy * 0.001)));
    r3d.dirty = true;
  },
}, endInteraction);
for (const id of ['sum', 'slice'])
  attachPointer($(`${id}-ov`), store, {
    onDrag: trackball,
    onWheel: (dy) => store.set('imgFov', Math.round(Math.min(200, Math.max(4, store.p.imgFov * Math.exp(dy * 0.001))))),
  }, endInteraction);
v3dBtns[0].onclick = () => r3d.setView('beam');
v3dBtns[1].onclick = () => r3d.setView('side');
v3dBtns[2].onclick = () => r3d.setView('oblique');

// keyboard: arrows tilt (pattern moves the way of the arrow), q/e rotate in plane
let keyTimer = 0;
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  const step = store.p.step * DEG * (e.shiftKey ? 5 : e.altKey ? 0.2 : 1);
  let used = true;
  switch (e.key) {
    case 'ArrowUp': store.tiltBy(step, 0); break;
    case 'ArrowDown': store.tiltBy(-step, 0); break;
    case 'ArrowRight': store.tiltBy(0, -step); break;
    case 'ArrowLeft': store.tiltBy(0, step); break;
    case 'q': case 'Q': store.rotateInPlane(step); break;
    case 'e': case 'E': store.rotateInPlane(-step); break;
    case 'z': case 'Z': goNearest(); break;
    case '0': store.setTilt(0, 0); break;
    case 't': case 'T': trainer.active ? trainer.stop() : trainer.begin(trainer.level); break;
    case 'h': case 'H': if (trainer.active) trainer.toggleHint(); break;
    case '?': ($('help') as HTMLDialogElement).showModal(); break;
    default: used = false;
  }
  if (used) {
    e.preventDefault();
    if (e.key.startsWith('Arrow') || 'qQeE'.includes(e.key)) {
      store.interacting = true;
      map.lowRes = true;
      clearTimeout(keyTimer);
      keyTimer = window.setTimeout(() => {
        store.interacting = false;
        endInteraction();
      }, 180);
    }
  }
});

let anim = 0;
function animateTo(alpha: number, beta: number) {
  cancelAnimationFrame(anim);
  const a0 = store.holder.alpha, b0 = store.holder.beta;
  const t0 = performance.now();
  const dur = 350;
  const stepf = () => {
    const u = Math.min(1, (performance.now() - t0) / dur);
    const w = u * u * (3 - 2 * u);
    store.interacting = u < 1;
    store.setTilt(a0 + (alpha - a0) * w, b0 + (beta - b0) * w);
    if (u < 1) anim = requestAnimationFrame(stepf);
    else endInteraction();
  };
  stepf();
}
function animateToDir(u: Vec3) {
  const t = tiltToBring(store.holder.mount, u);
  const p = store.p;
  if (p.enforceLimits && (Math.abs(t.alpha) > p.alphaLim * DEG || Math.abs(t.beta) > p.betaLim * DEG))
    toast(`Needs α ${fmt(t.alpha / DEG, 2)}°, β ${fmt(t.beta / DEG, 2)}°: beyond the holder limits (±${p.alphaLim}°, ±${p.betaLim}°). Stopped at the limit.`);
  animateTo(t.alpha, t.beta);
}
function goNearest() {
  const n = nearestList(1)[0];
  if (n) animateToDir(n.zone.dir);
}
const nearestList = (k: number) =>
  nearestZones(store.beamCrystal(), store.zones().filter((z) => Math.max(...z.uvw.map(Math.abs)) <= store.p.mapZoneIdx), k);

// ---------------------------------------------------------------------------------------------
// header: crystal, CIF, zone entry, training, theme, share
const sel = $<HTMLSelectElement>('crystal');
function syncCrystalSelect() {
  sel.innerHTML = '';
  for (const n of store.crystalNames) sel.append(el('option', { value: n, text: n }));
  sel.value = store.p.crystal;
  $('cinfo').textContent = `${formula(store.crystal)} · ${store.crystal.note ?? ''} · a=${fmt(store.crystal.lattice.a, 3)} Å`;
}
sel.addEventListener('change', () => store.loadCrystal(sel.value));
const fileInput = $<HTMLInputElement>('cif-file');
$('cif-btn').onclick = () => fileInput.click();
async function loadCifFile(f: File) {
  try {
    const text = await f.text();
    const c = parseCIF(text, f.name.replace(/\.cif$/i, ''));
    const name = store.addUserCrystal(c);
    saveCif(name, text);
    store.loadCrystal(name);
    toast(`Loaded ${name}: ${c.sites.length} atoms/cell${c.note && c.note.startsWith('no symmetry') ? ' (warning: ' + c.note + ')' : ''}`);
  } catch (err) {
    toast(`CIF error: ${(err as Error).message}`);
  }
}
fileInput.addEventListener('change', () => fileInput.files?.[0] && loadCifFile(fileInput.files[0]));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) loadCifFile(f);
});
const parseUVW = (s: string): Vec3 | null => {
  const t = s.trim().replace(/[[\]]/g, '');
  const parts = /[\s,]/.test(t) ? t.split(/[\s,]+/).filter(Boolean).map(Number) : (t.match(/-?\d/g) ?? []).map(Number);
  if (parts.length === 4 && store.crystal.lattice.isHexagonal) {
    const [U, V, , W] = parts;
    return [2 * U + V, 2 * V + U, W];
  }
  return parts.length === 3 && parts.every(Number.isFinite) && parts.some((x) => x !== 0) ? (parts as Vec3) : null;
};
$('mount-btn').onclick = () => {
  const z = parseUVW($<HTMLInputElement>('zone').value);
  if (z) store.mountZone(z);
  else toast('zone axis: enter u v w (or U V T W for hexagonal)');
};
$('tilt-btn').onclick = () => {
  const z = parseUVW($<HTMLInputElement>('zone').value);
  if (z) animateToDir(store.crystal.lattice.dirToCartUnit(z));
};
$<HTMLInputElement>('zone').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') $('tilt-btn').click();
});
$('train-btn').onclick = () => (trainer.active ? trainer.stop() : trainer.begin(trainer.level));
$('help-btn').onclick = () => ($('help') as HTMLDialogElement).showModal();
$('theme-btn').onclick = () => {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur;
  try {
    localStorage.setItem('zoner.theme', cur);
  } catch {
    /* ignore */
  }
};
$('share-btn').onclick = async () => {
  const url = location.href.split('#')[0] + encodeHash(store);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link with this orientation and settings copied');
  } catch {
    prompt('Copy this link', url);
  }
};
$('side-btn').onclick = () => document.body.classList.toggle('noside');

function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout((t as unknown as { _t: number })._t);
  (t as unknown as { _t: number })._t = window.setTimeout(() => t.classList.remove('show'), 4000);
}

// ---------------------------------------------------------------------------------------------
// info panel
function renderInfo() {
  infoDirty = false;
  const s = store, p = s.p;
  const L = s.crystal.lattice;
  const info = $('info');
  const a = s.holder.alpha / DEG, b = s.holder.beta / DEG;
  const lim = (v: number, l: number) => (p.enforceLimits && Math.abs(v) >= l - 1e-6 ? ' lim' : '');
  if (trainer.active) {
    const lvl = LEVELS[trainer.level];
    info.innerHTML = `
      <div class="train">
        <div class="big">${trainer.solved ? '✔ ' : ''}${trainer.status()}</div>
        <div class="muted">${lvl.label}</div>
        <div class="tiltrow"><span>α ${fmt(a, 2)}°</span><span>β ${fmt(b, 2)}°</span></div>
        <div class="muted">Tilt with arrow keys or drag the pattern until a zone axis is on the optic axis.
        Bands crossing symmetrically at the centre = on zone.</div>
        <div class="row-btns">
          ${(Object.keys(LEVELS) as Level[]).map((l) => `<button class="mini lvl${l === trainer.level ? ' on' : ''}" data-l="${l}">${l}</button>`).join('')}
          <button class="mini" id="t-new">new (T to quit)</button>
          <button class="mini" id="t-hint">${trainer.hint ? 'hide hint' : 'hint (H)'}</button>
        </div>
        <div class="muted">Best: ${(Object.keys(LEVELS) as Level[]).map((l) => `${l} ${Number.isFinite(trainer.best(l)) ? trainer.best(l).toFixed(1) + ' s' : '—'}`).join(' · ')}</div>
        ${trainer.solved ? `<div class="ok">Zone ${htmlDir(L, trainer.solved.zone.uvw)} reached. Press "new" for another.</div>` : ''}
      </div>`;
    info.querySelectorAll<HTMLButtonElement>('.lvl').forEach((bt) => (bt.onclick = () => trainer.begin(bt.dataset.l as Level)));
    $('t-new').onclick = () => trainer.begin(trainer.level);
    $('t-hint').onclick = () => {
      trainer.toggleHint();
      infoDirty = true;
    };
    return;
  }
  const bc = s.beamCrystal();
  const uvw = L.cartToDir(bc);
  const mx = Math.max(...uvw.map(Math.abs));
  const near = nearestList(7);
  const R = s.refl();
  const zs = s.zoneSet();
  const dW = s.dRange()[1];
  const rs = resolution2D(R, bc, s.transfer('slice'), zs, TAU, dW);
  const rt = resolution2D(R, bc, s.transfer('sum'), zs, TAU, dW);
  const th = near[0]?.angle ?? 0;
  const dzEff = Math.max(p.sliceThickness, p.depthRes);
  const fmtD = (r: { d: number; zone: Vec3 | null }) => (Number.isFinite(r.d) ? `${fmt(r.d, 2)} Å <span class="muted">(${htmlDir(L, r.zone!)})</span>` : `&gt; ${fmt(dW, 1)} Å`);
  info.innerHTML = `
    <div class="tiltrow"><span class="${lim(a, p.alphaLim)}">α <b>${fmt(a, 2)}°</b></span><span class="${lim(b, p.betaLim)}">β <b>${fmt(b, 2)}°</b></span>
    <span class="muted">beam ∥ [${uvw.map((x) => fmt(x / mx, 3)).join(' ')}]</span></div>
    <table class="zones"><thead><tr><th>zone</th><th>off</th><th>α</th><th>β</th><th></th></tr></thead><tbody>
    ${near.map((n, i) => {
      const t = tiltToBring(s.holder.mount, n.zone.dir);
      const ta = t.alpha / DEG, tb = t.beta / DEG;
      const out = Math.abs(ta) > p.alphaLim || Math.abs(tb) > p.betaLim;
      return `<tr class="${out ? 'out' : ''}"><td>${htmlDir(L, n.zone.uvw)}</td><td>${fmt(n.angle / DEG, 2)}°</td><td>${fmt(ta, 2)}</td><td>${fmt(tb, 2)}</td><td><button class="mini go" data-i="${i}">go</button></td></tr>`;
    }).join('')}
    </tbody></table>
    <div class="kv"><span>2D resolution, MEP slice</span><b>${fmtD(rs)}</b></div>
    <div class="kv"><span>2D resolution, depth sum</span><b>${fmtD(rt)}</b></div>
    <div class="kv"><span>column smear (nearest zone): slice / total</span><b>${fmt(dzEff * 10 * Math.tan(th), 2)} / ${fmt(p.thickness * 10 * Math.tan(th), 2)} Å</b></div>
    <div class="kv muted"><span>λ = ${fmt(s.lambda * 100, 3)} pm · K = ${fmt(s.K, 2)} Å⁻¹ · ${R.n} reflections (|g| ≤ ${fmt(R.gmax, 2)} Å⁻¹)</span></div>
    <div class="kv muted"><span>${dp.blochStatus() || 'frame ms'}</span><span>DP ${fmt(dp.lastMs, 1)} · map ${fmt(map.lastMs, 1)} · sum ${fmt(imSum.lastMs, 1)} · slice ${fmt(imSlice.lastMs, 1)} · 3D ${fmt(r3d.lastMs, 1)}</span></div>`;
  info.querySelectorAll<HTMLButtonElement>('.go').forEach((bt) => (bt.onclick = () => animateToDir(near[+bt.dataset.i!].zone.dir)));
}
function renderTrainingUI() {
  $('train-btn').classList.toggle('on', trainer.active);
  markAll();
}

// ---------------------------------------------------------------------------------------------
// persistence
function saveLocal() {
  try {
    localStorage.setItem('zoner.state', encodeHash(store));
  } catch {
    /* ignore */
  }
}
function saveCif(name: string, text: string) {
  try {
    const all = JSON.parse(localStorage.getItem('zoner.cifs') ?? '{}');
    all[name] = text;
    localStorage.setItem('zoner.cifs', JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
function restore() {
  try {
    const th = localStorage.getItem('zoner.theme');
    if (th) document.documentElement.dataset.theme = th;
    const all = JSON.parse(localStorage.getItem('zoner.cifs') ?? '{}') as Record<string, string>;
    for (const [n, t] of Object.entries(all)) {
      try {
        store.addUserCrystal({ ...parseCIF(t, n), name: n });
      } catch {
        /* skip broken */
      }
    }
  } catch {
    /* ignore */
  }
  let applied = false;
  if (location.hash.length > 1) applied = decodeHash(store, location.hash);
  if (!applied) {
    try {
      const s = localStorage.getItem('zoner.state');
      if (s) decodeHash(store, s);
    } catch {
      /* ignore */
    }
  }
  store.applyDW();
}
restore();
syncCrystalSelect();
controls.refresh();

// ---------------------------------------------------------------------------------------------
// render loop
// Adaptive throttling: while the user is dragging, a slow panel (> 30 ms per render, e.g. software
// GL on an old laptop) is re-rendered at most every ~3 of its render times so the DP stays responsive;
// everything is redrawn when the interaction ends.
const lastAt = new Map<object, number>();
function frame() {
  const hidden = trainer.active;
  const now = performance.now();
  for (const v of views) {
    if (!v.dirty) continue;
    if (hidden && v !== dp) {
      v.dirty = false;
      continue;
    }
    if (store.interacting && v !== dp && v.lastMs > 30 && now - (lastAt.get(v) ?? 0) < 3 * v.lastMs) continue;
    lastAt.set(v, now);
    try {
      v.render();
    } catch (err) {
      console.error(err);
      v.dirty = false;
    }
  }
  if (infoDirty || trainer.active) renderInfo();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for benchmarks / automation
const zoneLab = (uvw: Vec3) => matVec(store.R(), store.crystal.lattice.dirToCartUnit(uvw));
(window as unknown as Record<string, unknown>).zoner = {
  store, dp, map, r3d, imSum, imSlice, trainer, markAll,
  /** Kikuchi-pattern centre of zone uvw in the DP (1/A) */
  kc: (uvw: Vec3) => {
    const d = zoneLab(uvw);
    return [-store.K * d[0], -store.K * d[1]];
  },
  /** CSS position of zone uvw on the stereogram */
  mapPos: (uvw: Vec3) => map.fromP(stereoForward(zoneLab(uvw))),
  zoneLab,
  angleTo: (uvw: Vec3) => angleBetween(store.beamCrystal(), store.crystal.lattice.dirToCartUnit(uvw)) / DEG,
};
