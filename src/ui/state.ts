// Global app state: one holder orientation shared by every panel, the parameter set, and lazily
// derived physics data. Panels subscribe and re-render on change.
import { Crystal, builtinCrystal, defaultZone, setDebyeWaller, BUILTIN_NAMES } from '../physics/crystal';
import { Holder, mountForZone, tiltToBring } from '../physics/orientation';
import { matMul, rotX, rotY, orthonormalize } from '../physics/linalg';
import { buildReflections, ReflectionSet } from '../physics/structure';
import { enumerateZones, Zone } from '../physics/zones';
import { wavelength } from '../physics/constants';
import { Mat3, Vec3, matVec, transpose, rotationIsFinite } from './util';
import { TransferParams, ZoneSet, buildZoneSet } from '../physics/transfer';

export interface Params {
  crystal: string;
  kV: number;
  convAlpha: number; // mrad, probe semi-angle: DP disks (0 = parallel) and the lambda/alpha^2 depth
  collAngle: number; // mrad, square detector half-width (centre to edge): DP detector range and lambda/beta
  thickness: number; // nm
  sliceThickness: number; // nm
  depthRes: number; // nm FWHM
  depthAuto: boolean; // depthRes = lambda / alpha^2 from kV and convAlpha (a typed depthRes unchecks it)
  lateralRes: number; // A FWHM
  lateralAuto: boolean; // lateralRes = lambda / beta (collection angle); a typed lateralRes unchecks it
  sliceDepth: number; // nm, depth of the MEP slice centre below the entrance surface
  dw: number; // A^2 Debye-Waller B for all sites
  // diffraction
  dpTheory: 'kinematic' | 'twobeam' | 'bloch';
  dpRange: number; // 1/A half width of the DP view
  dpDisplay: 'auto' | 'log' | 'gamma'; // auto = log for SAED, gamma for CBED
  dpDecades: number; // log display dynamic range
  dpSpot: number; // spot sigma (px at 512)
  kikuchi: number; // 0..1
  dpLabels: boolean;
  dpLaue: boolean;
  dpDetector: boolean; // detector (collection) range drawn on the DP, beyond it dimmed
  dpCmap: string;
  blochBeams: number;
  // images
  imgMode: 'sum' | 'slice'; // real-space image shown, and the depth transfer that colours the stereogram
  imgFov: number; // A
  imgCmap: string;
  imgAuto: boolean;
  // stereogram
  mapRange: number; // deg half-width
  mapSyncDP: boolean; // mapRange follows the DP half-width (asin(dpRange / K)); choosing a range ends it
  mapZoneIdx: number;
  mapTraces: boolean;
  mapRings: boolean; // dashed tilt rings (the hover readout gives the same numbers)
  mapCmap: string;
  // 3D
  view3d: 'slab' | 'cluster';
  slabWidth: number; // A
  atomScale: number;
  // holder
  alphaLim: number; // deg
  betaLim: number; // deg
  enforceLimits: boolean; // holder range switch: off while matching the pattern, then engaged
  step: number; // deg per arrow key
}

export const DEFAULTS: Params = {
  crystal: 'Si', kV: 300, convAlpha: 3, collAngle: 90, thickness: 20, sliceThickness: 2, depthRes: 3, depthAuto: false, lateralRes: 0.5, lateralAuto: false,
  sliceDepth: 10, dw: 0.5,
  dpTheory: 'twobeam', dpRange: 2.2, dpDisplay: 'auto', dpDecades: 3.5, dpSpot: 2.2, kikuchi: 0.5,
  dpLabels: true, dpLaue: false, dpDetector: false, dpCmap: 'gray', blochBeams: 61,
  imgMode: 'sum', imgFov: 20, imgCmap: 'gray', imgAuto: true,
  mapRange: 20, mapSyncDP: false, mapZoneIdx: 3, mapTraces: true, mapRings: false, mapCmap: 'viridis',
  view3d: 'slab', slabWidth: 14, atomScale: 1,
  alphaLim: 35, betaLim: 30, enforceLimits: false, step: 0.2,
};

const DEG = Math.PI / 180;
/** Largest depth resolution (nm): the cap of lambda / alpha^2 as alpha -> 0, and the control's max. */
export const DEPTH_RES_MAX = 1000;
/** Depth resolution lambda / alpha^2 (nm, rounded to 0.01 nm) for the probe semi-angle alpha (mrad). */
export function autoDepthRes(kV: number, alphaMrad: number): number {
  const a = alphaMrad * 1e-3;
  const d = wavelength(kV) / (a * a) / 10;
  return Number.isFinite(d) && d < DEPTH_RES_MAX ? Math.round(d * 100) / 100 : DEPTH_RES_MAX;
}
/** Largest lateral resolution (A): the cap of lambda / beta as beta -> 0, and the control's max. */
export const LATERAL_RES_MAX = 5;
/** Lateral resolution lambda / beta (A, rounded to 0.001 A) for the collection angle beta (mrad). */
export function autoLateralRes(kV: number, betaMrad: number): number {
  const d = wavelength(kV) / (betaMrad * 1e-3);
  return Number.isFinite(d) && d < LATERAL_RES_MAX ? Math.round(d * 1000) / 1000 : LATERAL_RES_MAX;
}
/** Map half-range (deg) matching a DP half-width (1/A): the tilt whose Kikuchi centre sits at the
 *  edge of the DP, asin(q / K). */
export const syncedMapRange = (dpRange: number, K: number) => (Math.asin(Math.min(1, dpRange / K)) * 180) / Math.PI;
/** Coarsest resolution still counted as atomic (A): top of the resolution colour scale. */
export const D_ATOMIC = 1.5;

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
    // a value set by hand ends its automatic source
    if (key === 'depthRes') this.p.depthAuto = false;
    if (key === 'lateralRes') this.p.lateralAuto = false;
    if (key === 'mapRange') this.p.mapSyncDP = false;
    this.syncDerived();
    if (key === 'crystal') this.loadCrystal(value as string);
    else if (key === 'dw') {
      this.crystal = setDebyeWaller(this.crystalBase, this.p.dw);
      this.emit('crystal');
    } else this.emit('params');
  }

  /** Values that follow others (call after setting params directly): depthRes = lambda / alpha^2,
   *  lateralRes = lambda / beta, mapRange = the DP half-width, each while its switch is on. */
  syncDerived() {
    const p = this.p;
    if (p.depthAuto) p.depthRes = autoDepthRes(p.kV, p.convAlpha);
    if (p.lateralAuto) p.lateralRes = autoLateralRes(p.kV, p.collAngle);
    if (p.mapSyncDP) p.mapRange = syncedMapRange(p.dpRange, this.K);
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
  /**
   * Holder range switch. Engage the limits with the stage reading (deg) that the current orientation
   * corresponds to: the crystal keeps its orientation, the mount absorbs the difference, and from
   * now on alpha/beta are clamped to the range. Works at any time, also while already engaged
   * (re-anchors). Default reading: see defaultStageReading. Returns false (and changes nothing)
   * only for an explicit reading outside the range.
   */
  engageHolder(alphaDeg?: number, betaDeg?: number): boolean {
    if (alphaDeg === undefined || betaDeg === undefined) [alphaDeg, betaDeg] = this.defaultStageReading();
    if (!Number.isFinite(alphaDeg) || !Number.isFinite(betaDeg)) return false;
    if (Math.abs(alphaDeg) > this.p.alphaLim + 1e-9 || Math.abs(betaDeg) > this.p.betaLim + 1e-9) return false;
    const a = alphaDeg * DEG, b = betaDeg * DEG;
    if (Math.abs(a - this.holder.alpha) > 1e-12 || Math.abs(b - this.holder.beta) > 1e-12) {
      // R = Rx(a) Ry(b) M'  =>  M' = (Rx(a) Ry(b))^T R
      const T = matMul(rotX(a), rotY(b));
      this.holder = new Holder(orthonormalize(matMul(transpose(T), this.R())), a, b);
    }
    this.p.enforceLimits = true;
    this.emit('params');
    this.emit('orientation');
    return true;
  }
  /** Stage reading assumed when none is typed: the current alpha/beta if they are inside the range
   *  (the mount already matches the stage), otherwise 0/0 (orientation matched freely). */
  defaultStageReading(): [number, number] {
    const a = this.holder.alpha / DEG, b = this.holder.beta / DEG;
    return Math.abs(a) <= this.p.alphaLim && Math.abs(b) <= this.p.betaLim ? [a, b] : [0, 0];
  }
  releaseHolder() {
    this.p.enforceLimits = false;
    this.emit('params');
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
      sliceDepth: this.p.sliceDepth * 10,
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
  /** Colour-scale limits of the resolution map (A): best = lateral limit, worst = 1.5 A (anything
   *  coarser is not atomic resolution and is drawn grey / reported as "> 1.5 A"). */
  dRange(): [number, number] {
    return [this.p.lateralRes, Math.max(D_ATOMIC, 1.25 * this.p.lateralRes)];
  }
}
