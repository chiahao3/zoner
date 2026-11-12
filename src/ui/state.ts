// Global app state: one holder orientation shared by every panel, the parameter set, and lazily
// derived physics data. Panels subscribe and re-render on change.
import { Crystal, builtinCrystal, defaultZone, setDebyeWaller, BUILTIN_NAMES } from '../physics/crystal';
import { Holder, mountForZone, tiltToBring } from '../physics/orientation';
import { buildReflections, ReflectionSet } from '../physics/structure';
import { enumerateZones, Zone } from '../physics/zones';
import { wavelength } from '../physics/constants';
import { Mat3, Vec3, matVec, transpose, rotationIsFinite } from './util';
import { TransferParams, ZoneSet, buildZoneSet } from '../physics/transfer';

export interface Params {
  crystal: string;
  kV: number;
  convAlpha: number; // mrad, probe semi-angle for imaging (and DP if dpAlphaSame)
  thickness: number; // nm
  sliceThickness: number; // nm
  depthRes: number; // nm FWHM
  lateralRes: number; // A FWHM
  sliceDepth: number; // nm, depth of the MEP slice centre below the entrance surface
  dw: number; // A^2 Debye-Waller B for all sites
  // diffraction
  dpIllum: 'parallel' | 'convergent';
  dpAlpha: number; // mrad for the DP when convergent
  dpTheory: 'kinematic' | 'twobeam' | 'bloch';
  dpRange: number; // 1/A half width of the DP view
  dpDisplay: 'auto' | 'log' | 'gamma'; // auto = log for SAED, gamma for CBED
  dpDecades: number; // log display dynamic range
  dpSpot: number; // spot sigma (px at 512)
  kikuchi: number; // 0..1
  dpLabels: boolean;
  dpLaue: boolean;
  dpCmap: string;
  blochBeams: number;
  // images
  imgFov: number; // A
  imgCmap: string;
  imgAuto: boolean;
  // stereogram
  mapRange: number; // deg half-width
  mapSource: 'slice' | 'sum';
  mapZoneIdx: number;
  mapTraces: boolean;
  mapCmap: string;
  // 3D
  view3d: 'slab' | 'cluster';
  slabWidth: number; // A
  atomScale: number;
  // holder
  alphaLim: number; // deg
  betaLim: number; // deg
  enforceLimits: boolean;
  step: number; // deg per arrow key
}

export const DEFAULTS: Params = {
  crystal: 'Si', kV: 300, convAlpha: 20, thickness: 20, sliceThickness: 2, depthRes: 4.9, lateralRes: 0.5,
  sliceDepth: 10, dw: 0.5,
  dpIllum: 'parallel', dpAlpha: 2, dpTheory: 'twobeam', dpRange: 2.2, dpDisplay: 'auto', dpDecades: 3.5, dpSpot: 2.2, kikuchi: 0.5,
  dpLabels: true, dpLaue: false, dpCmap: 'gray', blochBeams: 61,
  imgFov: 20, imgCmap: 'gray', imgAuto: true,
  mapRange: 20, mapSource: 'slice', mapZoneIdx: 3, mapTraces: true, mapCmap: 'viridis',
  view3d: 'slab', slabWidth: 14, atomScale: 1,
  alphaLim: 35, betaLim: 30, enforceLimits: true, step: 0.2,
};

export type ChangeKind = 'orientation' | 'params' | 'crystal';
type Listener = (kinds: Set<ChangeKind>) => void;

export class Store {
  p: Params = { ...DEFAULTS };
  holder: Holder;
  crystalBase: Crystal;
  crystal: Crystal;
  userCrystals = new Map<string, Crystal>();
  /** bumped whenever orientation changes */
  orientVersion = 0;
  interacting = false; // true while the user is dragging / holding a key
  private listeners: Listener[] = [];
  private pending = new Set<ChangeKind>();
  private scheduled = false;
  private _refl: ReflectionSet | null = null;
  private _reflKey = '';
  private _zones: Zone[] | null = null;
  private _zonesKey = '';
  private _zs: ZoneSet | null = null;
  private _zsKey = '';

  constructor() {
    this.crystalBase = builtinCrystal(this.p.crystal);
    this.crystal = setDebyeWaller(this.crystalBase, this.p.dw);
    this.holder = new Holder(mountForZone(this.crystal.lattice, defaultZone(this.crystal)));
  }

  get crystalNames(): string[] {
    return [...BUILTIN_NAMES, ...this.userCrystals.keys()];
  }
  get K() {
    return 1 / wavelength(this.p.kV);
  }
  get lambda() {
    return wavelength(this.p.kV);
  }
  R(): Mat3 {
    return this.holder.R();
  }
  beamCrystal(): Vec3 {
    return this.holder.beamCrystal();
  }

  subscribe(f: Listener) {
    this.listeners.push(f);
  }
  emit(kind: ChangeKind) {
    if (kind === 'orientation') this.orientVersion++;
    this.pending.add(kind);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const k = new Set(this.pending);
      this.pending.clear();
      for (const f of this.listeners) f(k);
    });
  }

  set<K extends keyof Params>(key: K, value: Params[K]) {
    if (this.p[key] === value) return;
    this.p[key] = value;
    if (key === 'crystal') this.loadCrystal(value as string);
    else if (key === 'dw') {
      this.crystal = setDebyeWaller(this.crystalBase, this.p.dw);
      this.emit('crystal');
    } else this.emit('params');
  }

  loadCrystal(name: string, zone?: Vec3) {
    const c = this.userCrystals.get(name) ?? builtinCrystal(name);
    this.p.crystal = name;
    this.crystalBase = c;
    this.crystal = setDebyeWaller(c, this.p.dw);
    this.holder = new Holder(mountForZone(c.lattice, zone ?? defaultZone(c)));
    this.emit('crystal');
    this.emit('orientation');
  }

  /** Re-apply the global Debye-Waller factor (after parameters were set directly). */
  applyDW() {
    this.crystal = setDebyeWaller(this.crystalBase, this.p.dw);
    this.emit('crystal');
  }

  addUserCrystal(c: Crystal): string {
    let name = c.name;
    let k = 2;
    while (BUILTIN_NAMES.includes(name) || (this.userCrystals.has(name) && this.userCrystals.get(name) !== c)) name = `${c.name}-${k++}`;
    this.userCrystals.set(name, { ...c, name });
    return name;
  }

  // ---- orientation -------------------------------------------------------------------------
  private clampTilt(a: number, b: number): [number, number] {
    if (!this.p.enforceLimits) return [a, b];
    const al = (this.p.alphaLim * Math.PI) / 180, bl = (this.p.betaLim * Math.PI) / 180;
    return [Math.max(-al, Math.min(al, a)), Math.max(-bl, Math.min(bl, b))];
  }
  setTilt(alpha: number, beta: number) {
    [alpha, beta] = this.clampTilt(alpha, beta);
    if (alpha === this.holder.alpha && beta === this.holder.beta) return;
    this.holder.alpha = alpha;
    this.holder.beta = beta;
    this.emit('orientation');
  }
  tiltBy(dAlpha: number, dBeta: number) {
    this.setTilt(this.holder.alpha + dAlpha, this.holder.beta + dBeta);
  }
  /** Apply a lab-frame rotation Q to the crystal as closely as the double-tilt holder allows. */
  applyLabRotation(Q: Mat3) {
    if (!rotationIsFinite(Q)) return;
    // new beam direction in the crystal frame: (Q R)^T z = R^T Q^T z
    const n = matVec(transpose(this.R()), matVec(transpose(Q), [0, 0, 1]));
    const t = tiltToBring(this.holder.mount, n);
    this.setTilt(t.alpha, t.beta);
  }
  /** Tilt so that crystal direction u (Cartesian, unit) is along the beam. */
  goToDirection(u: Vec3) {
    const t = tiltToBring(this.holder.mount, u);
    this.setTilt(t.alpha, t.beta);
  }
  rotateInPlane(t: number) {
    this.holder.rotateInPlane(t);
    this.emit('orientation');
  }
  /** Re-mount so that zone [uvw] is on the beam at zero tilt. */
  mountZone(uvw: Vec3) {
    this.holder = new Holder(mountForZone(this.crystal.lattice, uvw));
    this.emit('orientation');
  }

  // ---- derived -----------------------------------------------------------------------------
  transfer(mode: 'slice' | 'sum'): TransferParams {
    return {
      lateralRes: this.p.lateralRes,
      mode,
      sliceThickness: this.p.sliceThickness * 10,
      depthRes: this.p.depthRes * 10,
      totalThickness: this.p.thickness * 10,
    };
  }
  /** Reflections for DP, images and map: up to the larger of the DP view and the lateral limit. */
  refl(): ReflectionSet {
    const gmax = Math.min(Math.max(this.p.dpRange * 1.5, 1.45 / this.p.lateralRes), 6);
    const key = `${this.p.crystal}|${this.p.dw}|${this.p.kV}|${gmax.toFixed(3)}`;
    if (!this._refl || key !== this._reflKey) {
      this._refl = buildReflections(this.crystal, gmax, this.p.kV);
      this._reflKey = key;
    }
    return this._refl;
  }
  zones(): Zone[] {
    const key = `${this.p.crystal}|${this.p.mapZoneIdx}`;
    if (!this._zones || key !== this._zonesKey) {
      this._zones = enumerateZones(this.crystal.lattice, Math.max(this.p.mapZoneIdx, 3));
      this._zonesKey = key;
    }
    return this._zones;
  }
  /** Low-index zones (index <= mapZoneIdx) with their ZOLZ lists, for the resolution metric. */
  zoneSet(): ZoneSet {
    const R = this.refl();
    const key = `${this._reflKey}|${this.p.mapZoneIdx}|${this.p.lateralRes}`;
    if (!this._zs || key !== this._zsKey) {
      const zs = this.zones().filter((z) => Math.max(...z.uvw.map(Math.abs)) <= this.p.mapZoneIdx);
      this._zs = buildZoneSet(R, zs, this.p.lateralRes);
      this._zsKey = key;
    }
    return this._zs;
  }
  /** Colour-scale limits of the resolution map (A): best = lateral limit, worst. */
  dRange(): [number, number] {
    return [this.p.lateralRes, Math.max(2.5, 4 * this.p.lateralRes)];
  }
}
