// Sidebar parameter controls generated from a schema; two-way bound to the store.
import { Store, Params } from './state';
import { el } from './util';

type Opt = string | [string, string];
interface Ctl {
  key: keyof Params;
  label: string;
  type: 'number' | 'range' | 'select' | 'check';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Opt[];
  title?: string;
  auto?: { label: string; fn: (s: Store) => number; title: string };
}
interface Group {
  name: string;
  open?: boolean;
  ctls: Ctl[];
}

const CMAPS = ['gray', 'inferno', 'magma', 'viridis', 'turbo'];

export const GROUPS: Group[] = [
  {
    name: 'Beam & specimen', open: true,
    ctls: [
      { key: 'kV', label: 'High tension', type: 'select', unit: 'kV', options: ['60', '80', '120', '200', '300'] },
      { key: 'thickness', label: 'Thickness t', type: 'number', min: 0.5, max: 500, step: 0.5, unit: 'nm' },
      { key: 'convAlpha', label: 'Convergence α', type: 'number', min: 0, max: 60, step: 0.5, unit: 'mrad', title: 'Probe semi-angle. 0 = parallel beam (SAED spots). Disks are drawn as CBED once they are larger than the spot size, otherwise as spots. Also used by the λ/2α and λ/α² estimate buttons.' },
      { key: 'dw', label: 'Debye-Waller B', type: 'number', min: 0, max: 3, step: 0.05, unit: 'Å²' },
    ],
  },
  {
    name: 'MEP / imaging', open: true,
    ctls: [
      {
        key: 'lateralRes', label: 'Lateral resolution', type: 'number', min: 0.1, max: 5, step: 0.05, unit: 'Å',
        title: 'FWHM of the lateral PSF; also the |g| cut-off of the resolution map',
        auto: { label: 'λ/2α', fn: (s) => (s.p.convAlpha > 0 ? +(s.lambda / (2 * s.p.convAlpha * 1e-3)).toFixed(2) : s.p.lateralRes), title: 'aperture-limited estimate λ/(2α)' },
      },
      {
        key: 'depthRes', label: 'Depth resolution', type: 'number', min: 0, max: 100, step: 0.1, unit: 'nm',
        title: 'FWHM of the depth PSF of a reconstructed slice',
        auto: { label: 'λ/α²', fn: (s) => (s.p.convAlpha > 0 ? +((s.lambda / (s.p.convAlpha * 1e-3) ** 2) / 10).toFixed(1) : s.p.depthRes), title: 'aperture-limited estimate λ/α²' },
      },
      { key: 'sliceThickness', label: 'Slice thickness Δz', type: 'number', min: 0.1, max: 100, step: 0.1, unit: 'nm' },
      { key: 'sliceDepth', label: 'Slice depth z', type: 'range', min: 0, max: 20, step: 0.1, unit: 'nm', title: 'centre of the displayed MEP slice below the entrance surface' },
      { key: 'imgFov', label: 'Image field of view', type: 'number', min: 4, max: 200, step: 1, unit: 'Å' },
      { key: 'imgCmap', label: 'Image colormap', type: 'select', options: CMAPS },
      { key: 'imgAuto', label: 'Auto contrast', type: 'check', title: 'off = keep the current phase range, so contrast loss on tilting is visible' },
    ],
  },
  {
    name: 'Diffraction',
    open: true,
    ctls: [
      { key: 'dpTheory', label: 'Theory', type: 'select', options: [['kinematic', 'kinematic'], ['twobeam', 'two-beam per g (dynamical)'], ['bloch', 'Bloch wave, N beams']] },
      { key: 'blochBeams', label: 'Bloch beams N', type: 'number', min: 5, max: 201, step: 1 },
      { key: 'kikuchi', label: 'Kikuchi bands', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'dpDisplay', label: 'Display scale', type: 'select', options: [['auto', 'auto (log SAED, √ CBED)'], ['log', 'log'], ['gamma', '√ (gamma 0.5)']] },
      { key: 'dpDecades', label: 'Log range', type: 'range', min: 1, max: 7, step: 0.25, unit: 'dec' },
      { key: 'dpSpot', label: 'Spot size', type: 'range', min: 0.8, max: 6, step: 0.1 },
      { key: 'dpLabels', label: 'Index labels', type: 'check' },
      { key: 'dpLaue', label: 'Laue circle', type: 'check' },
      { key: 'dpCmap', label: 'DP colormap', type: 'select', options: CMAPS },
    ],
  },
  {
    name: 'Resolution map',
    ctls: [
      { key: 'mapSource', label: 'Colour by', type: 'select', options: [['slice', 'MEP slice'], ['sum', 'depth sum']] },
      { key: 'mapRange', label: 'Map half-range', type: 'select', unit: '°', options: ['3', '5', '10', '20', '30', '45', '60', '90'] },
      { key: 'mapZoneIdx', label: 'Zone index ≤', type: 'number', min: 1, max: 8, step: 1 },
      { key: 'mapTraces', label: 'Plane traces', type: 'check' },
      { key: 'mapCmap', label: 'Map colormap', type: 'select', options: ['viridis', 'turbo', 'inferno', 'magma'] },
    ],
  },
  {
    name: '3D view',
    ctls: [
      { key: 'view3d', label: 'Show', type: 'select', options: [['slab', 'specimen slab + slices'], ['cluster', 'unit cell cluster']] },
      { key: 'slabWidth', label: 'Slab width', type: 'number', min: 4, max: 60, step: 1, unit: 'Å' },
      { key: 'atomScale', label: 'Atom size', type: 'range', min: 0.3, max: 2, step: 0.05 },
    ],
  },
  {
    name: 'Holder',
    ctls: [
      { key: 'alphaLim', label: 'α range ±', type: 'number', min: 1, max: 90, step: 1, unit: '°', title: 'Symmetric limit: α can go from −value to +value (35 means −35° … +35°, 70° of travel)' },
      { key: 'betaLim', label: 'β range ±', type: 'number', min: 1, max: 90, step: 1, unit: '°', title: 'Symmetric limit: β can go from −value to +value (30 means −30° … +30°, 60° of travel)' },
      { key: 'enforceLimits', label: 'Enforce limits', type: 'check' },
      { key: 'step', label: 'Arrow-key step', type: 'number', min: 0.01, max: 5, step: 0.01, unit: '°' },
    ],
  },
];

const NUMERIC_SELECT = new Set<keyof Params>(['kV', 'mapRange']);

export class Controls {
  private inputs = new Map<keyof Params, HTMLInputElement | HTMLSelectElement>();
  private outs = new Map<keyof Params, HTMLElement>();
  constructor(private store: Store, root: HTMLElement) {
    for (const g of GROUPS) {
      const det = el('details', { class: 'grp' });
      if (g.open) det.open = true;
      det.append(el('summary', { text: g.name }));
      for (const c of g.ctls) det.append(this.row(c));
      root.append(det);
    }
    this.refresh();
  }

  private row(c: Ctl): HTMLElement {
    const s = this.store;
    const id = `ctl-${c.key}`;
    const row = el('div', { class: `row row-${c.type}` });
    if (c.title) row.title = c.title;
    const lab = el('label', { for: id, text: c.label });
    let input: HTMLInputElement | HTMLSelectElement;
    if (c.type === 'select') {
      const sel = el('select', { id });
      for (const o of c.options!) {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        sel.append(el('option', { value: v, text: t + (c.unit && !Array.isArray(o) ? ` ${c.unit}` : '') }));
      }
      sel.addEventListener('change', () => s.set(c.key, (NUMERIC_SELECT.has(c.key) ? +sel.value : sel.value) as never));
      input = sel;
    } else if (c.type === 'check') {
      const cb = el('input', { id, type: 'checkbox' });
      cb.addEventListener('change', () => s.set(c.key, cb.checked as never));
      input = cb;
    } else {
      const inp = el('input', { id, type: c.type === 'range' ? 'range' : 'number' });
      if (c.min !== undefined) inp.min = String(c.min);
      if (c.max !== undefined) inp.max = String(c.max);
      if (c.step !== undefined) inp.step = String(c.step);
      const apply = () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) s.set(c.key, v as never);
      };
      inp.addEventListener(c.type === 'range' ? 'input' : 'change', apply);
      if (c.type === 'number') inp.addEventListener('keydown', (e) => e.stopPropagation());
      input = inp;
    }
    this.inputs.set(c.key, input);
    row.append(lab);
    const wrap = el('div', { class: 'ctl' }, input);
    if (c.type === 'range' || (c.unit && c.type !== 'select')) {
      const out = el('span', { class: 'unit' });
      this.outs.set(c.key, out);
      wrap.append(out);
    }
    if (c.auto) {
      const b = el('button', { class: 'mini', text: c.auto.label, title: c.auto.title });
      b.addEventListener('click', () => s.set(c.key, c.auto!.fn(s) as never));
      wrap.append(b);
    }
    row.append(wrap);
    if (c.unit) row.dataset.unit = c.unit;
    return row;
  }

  refresh() {
    const p = this.store.p;
    for (const [k, inp] of this.inputs) {
      const v = p[k];
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.checked = !!v;
      else if (document.activeElement !== inp) inp.value = String(v);
      if (k === 'sliceDepth' && inp instanceof HTMLInputElement) inp.max = String(p.thickness);
      const out = this.outs.get(k);
      if (out) {
        const unit = inp.closest('.row')?.getAttribute('data-unit') ?? '';
        out.textContent = (inp as HTMLInputElement).type === 'range' ? `${v} ${unit}` : unit;
      }
    }
  }
}
