// Real-space 3D view. Scene frame = lab frame (x right, y up seen from the gun, z toward the gun).
// "slab": the specimen cut to slabWidth x slabWidth x thickness, entrance surface at z = 0 and depth
// going to -z, slice planes drawn and the current MEP slice highlighted (atoms outside it dimmed).
// "cluster": a ball of atoms around one unit cell with the cell edges and a/b/c axes.
// Left-drag tilts the crystal (trackball, the object follows the pointer); right-drag orbits the
// camera only; wheel zooms.
import * as THREE from 'three';
import { Store } from '../ui/state';
import { elementColor, displayRadius } from '../physics/elements';
import { species } from '../physics/crystal';
import { matVec, transpose, column, Vec3 } from '../ui/util';

export class CrystalView {
  dirty = true;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private atomsGroup = new THREE.Group();
  private decor = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private camTheta = 0; // camera orbit: polar angle from +z
  private camPhi = -Math.PI / 2;
  zoom = 1;
  private genKey = '';
  lastMs = 0;
  nAtoms = 0;
  labels: HTMLElement;

  constructor(private store: Store, readonly canvas: HTMLCanvasElement, labelLayer: HTMLElement) {
    this.labels = labelLayer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -2000, 2000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6);
    dl.position.set(0.4, 0.6, 1);
    this.scene.add(dl);
    this.scene.add(this.atomsGroup);
    this.scene.add(this.decor);
  }

  setView(v: 'beam' | 'side' | 'oblique') {
    if (v === 'beam') [this.camTheta, this.camPhi] = [0, -Math.PI / 2];
    else if (v === 'side') [this.camTheta, this.camPhi] = [Math.PI / 2, -Math.PI / 2];
    else [this.camTheta, this.camPhi] = [1.0, -1.1];
    this.dirty = true;
  }
  orbit(dx: number, dy: number) {
    this.camPhi -= dx * 0.01;
    this.camTheta = Math.max(0, Math.min(Math.PI, this.camTheta - dy * 0.01));
    this.dirty = true;
  }

  private clearAtoms() {
    for (const m of this.meshes) {
      this.atomsGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes = [];
  }

  private buildMeshes(positions: Map<string, number[]>, dimmed: Map<string, boolean[]>) {
    this.clearAtoms();
    const sc = this.store.p.atomScale;
    let total = 0;
    for (const [el, pos] of positions) {
      const n = pos.length / 3;
      if (!n) continue;
      const geo = new THREE.SphereGeometry(displayRadius(el) * sc, 12, 8);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      const m = new THREE.Matrix4();
      const base = new THREE.Color(elementColor(el));
      const dim = base.clone().multiplyScalar(0.28);
      const flags = dimmed.get(el);
      for (let i = 0; i < n; i++) {
        m.makeTranslation(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, flags && flags[i] ? dim : base);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.atomsGroup.add(mesh);
      this.meshes.push(mesh);
      total += n;
    }
    this.nAtoms = total;
  }

  /** Atoms of the crystal inside a lab-frame box |x|,|y| <= w/2, -t <= z <= 0. */
  private slabAtoms() {
    const s = this.store, p = s.p;
    const R = s.R();
    const Rt = transpose(R);
    const L = s.crystal.lattice;
    const w = p.slabWidth / 2;
    const t = Math.min(p.thickness * 10, 600);
    const corners: Vec3[] = [];
    for (const x of [-w, w]) for (const y of [-w, w]) for (const z of [-t, 0]) corners.push([x, y, z]);
    const fr = corners.map((c) => L.cartToDir(matVec(Rt, c)));
    const lo = [0, 1, 2].map((j) => Math.floor(Math.min(...fr.map((f) => f[j]))) - 1);
    const hi = [0, 1, 2].map((j) => Math.ceil(Math.max(...fr.map((f) => f[j]))) + 1);
    const pos = new Map<string, number[]>();
    const dim = new Map<string, boolean[]>();
    const z0 = p.sliceDepth * 10, dz = p.sliceThickness * 10;
    const A = L.A;
    // M = R * A maps fractional -> lab
    const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => R[3 * i] * A[j] + R[3 * i + 1] * A[3 + j] + R[3 * i + 2] * A[6 + j]));
    const cap = 120000;
    let count = 0;
    for (let a = lo[0]; a <= hi[0]; a++)
      for (let b = lo[1]; b <= hi[1]; b++)
        for (let c = lo[2]; c <= hi[2]; c++)
          for (const st of s.crystal.sites) {
            const f0 = a + st.frac[0], f1 = b + st.frac[1], f2 = c + st.frac[2];
            const x = M[0][0] * f0 + M[0][1] * f1 + M[0][2] * f2;
            if (x < -w || x > w) continue;
            const y = M[1][0] * f0 + M[1][1] * f1 + M[1][2] * f2;
            if (y < -w || y > w) continue;
            const z = M[2][0] * f0 + M[2][1] * f1 + M[2][2] * f2;
            if (z < -t || z > 0) continue;
            if (++count > cap) break;
            if (!pos.has(st.el)) {
              pos.set(st.el, []);
              dim.set(st.el, []);
            }
            pos.get(st.el)!.push(x, y, z);
            dim.get(st.el)!.push(Math.abs(-z - z0) > dz / 2);
          }
    return { pos, dim };
  }

  private clusterAtoms() {
    const s = this.store;
    const L = s.crystal.lattice;
    const rad = Math.max(8, 1.6 * Math.cbrt(L.volume));
    const pos = new Map<string, number[]>();
    const n = [L.a, L.b, L.c].map((x) => Math.ceil(rad / x) + 1);
    const ctr = L.dirToCart([0.5, 0.5, 0.5]);
    for (let a = -n[0]; a <= n[0]; a++)
      for (let b = -n[1]; b <= n[1]; b++)
        for (let c = -n[2]; c <= n[2]; c++)
          for (const st of s.crystal.sites) {
            const r = L.dirToCart([a + st.frac[0], b + st.frac[1], c + st.frac[2]]);
            if (Math.hypot(r[0] - ctr[0], r[1] - ctr[1], r[2] - ctr[2]) > rad) continue;
            if (!pos.has(st.el)) pos.set(st.el, []);
            pos.get(st.el)!.push(r[0] - ctr[0], r[1] - ctr[1], r[2] - ctr[2]);
          }
    return { pos, rad, ctr };
  }

  private clearDecor() {
    for (const c of [...this.decor.children]) {
      this.decor.remove(c);
      const anyc = c as THREE.Mesh;
      anyc.geometry?.dispose?.();
    }
  }

  private legendKey = '';
  /** Species legend (colour swatch, symbol, sites per cell) in the corner of the stage. */
  private updateLegend() {
    const s = this.store, p = s.p;
    const box = this.canvas.parentElement?.querySelector<HTMLElement>('.legend');
    const key = `${p.crystal}|${p.view3d}|${s.crystal.sites.length}`;
    if (!box || key === this.legendKey) return;
    this.legendKey = key;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    box.innerHTML =
      species(s.crystal).map((sp) => `<div><span class="sw" style="background:${elementColor(sp.el)}"></span>${esc(sp.el)}<span class="n">×${sp.n}</span></div>`).join('') +
      `<div class="n">${p.view3d === 'slab' ? 'per cell · dim = outside MEP slice' : 'per cell'}</div>`;
  }

  render() {
    const t0 = performance.now();
    this.dirty = false;
    const s = this.store, p = s.p;
    this.updateLegend();
    const r = this.canvas.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    const R = s.R();
    const m4 = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
    let fit = 10;
    let center = new THREE.Vector3();
    this.labels.innerHTML = '';
    if (p.view3d === 'slab') {
      const key = `slab|${p.crystal}|${s.orientVersion}|${p.slabWidth}|${p.thickness}|${p.sliceDepth}|${p.sliceThickness}|${p.atomScale}`;
      const t = Math.min(p.thickness * 10, 600);
      if (key !== this.genKey) {
        const { pos, dim } = this.slabAtoms();
        this.buildMeshes(pos, dim);
        this.genKey = key;
      }
      this.atomsGroup.matrixAutoUpdate = false;
      this.atomsGroup.matrix.identity();
      this.clearDecor();
      const w = p.slabWidth;
      // slab outline
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(w, w, t)),
        new THREE.LineBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.6 }),
      );
      box.position.set(0, 0, -t / 2);
      this.decor.add(box);
      // current MEP slice
      const dz = p.sliceThickness * 10;
      const sl = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.04, w * 1.04, dz),
        new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.12, depthWrite: false }),
      );
      sl.position.set(0, 0, -p.sliceDepth * 10);
      this.decor.add(sl);
      // slice boundaries
      const nsl = Math.min(400, Math.floor(t / dz));
      const pts: number[] = [];
      for (let k = 1; k <= nsl; k++) {
        const z = -k * dz;
        pts.push(-w / 2, -w / 2, z, w / 2, -w / 2, z, w / 2, -w / 2, z, w / 2, w / 2, z, w / 2, w / 2, z, -w / 2, w / 2, z, -w / 2, w / 2, z, -w / 2, -w / 2, z);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.decor.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x556677, transparent: true, opacity: 0.35 })));
      this.addBeam(4, w * 0.9);
      fit = Math.max(w, this.camTheta > 0.3 ? t * 0.6 : w) * 0.65;
      center = this.camTheta > 0.3 ? new THREE.Vector3(0, 0, -t / 2) : new THREE.Vector3(0, 0, 0);
    } else {
      const key = `cluster|${p.crystal}|${p.atomScale}`;
      const { pos, rad, ctr } = this.clusterAtoms();
      if (key !== this.genKey) {
        this.buildMeshes(pos, new Map<string, boolean[]>());
        this.genKey = key;
      }
      this.atomsGroup.matrixAutoUpdate = false;
      this.atomsGroup.matrix.copy(m4);
      this.clearDecor();
      const L = s.crystal.lattice;
      const cell = new THREE.Group();
      const A = [column(L.A, 0), column(L.A, 1), column(L.A, 2)];
      const o = [-ctr[0], -ctr[1], -ctr[2]];
      const P = (f: number[]) => [0, 1, 2].map((j) => o[j] + f[0] * A[0][j] + f[1] * A[1][j] + f[2] * A[2][j]);
      const edges: number[] = [];
      for (const [f, g] of [[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 1, 0]], [[1, 0, 0], [1, 0, 1]], [[0, 1, 0], [1, 1, 0]], [[0, 1, 0], [0, 1, 1]], [[0, 0, 1], [1, 0, 1]], [[0, 0, 1], [0, 1, 1]], [[1, 1, 0], [1, 1, 1]], [[1, 0, 1], [1, 1, 1]], [[0, 1, 1], [1, 1, 1]]])
        edges.push(...P(f), ...P(g));
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
      cell.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xffffff })));
      const cols = [0xff5555, 0x55dd55, 0x5599ff];
      ['a', 'b', 'c'].forEach((name, j) => {
        const dir = new THREE.Vector3(...A[j]).normalize();
        const len = Math.max(L.a, L.b, L.c) * 0.9;
        const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(...(o as [number, number, number])), len, cols[j], len * 0.18, len * 0.1);
        cell.add(arrow);
        const tip = new THREE.Vector3(...(o as [number, number, number])).addScaledVector(dir, len * 1.08);
        tip.applyMatrix4(m4);
        this.label(tip, name, '#' + cols[j].toString(16).padStart(6, '0'));
      });
      cell.matrixAutoUpdate = false;
      cell.matrix.copy(m4);
      this.decor.add(cell);
      this.addBeam(rad + 4, 0);
      fit = rad * 1.15;
    }
    // camera
    const asp = r.width / Math.max(1, r.height);
    const half = fit / this.zoom;
    this.camera.left = -half * asp;
    this.camera.right = half * asp;
    this.camera.top = half;
    this.camera.bottom = -half;
    const dir = new THREE.Vector3(Math.sin(this.camTheta) * Math.cos(this.camPhi), Math.sin(this.camTheta) * Math.sin(this.camPhi), Math.cos(this.camTheta));
    this.camera.position.copy(center).addScaledVector(dir, 500);
    this.camera.up.set(0, this.camTheta < 0.05 ? 1 : 0, this.camTheta < 0.05 ? 0 : 1);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    // project pending labels
    for (const lab of this.pending) {
      const v = lab.p.clone().project(this.camera);
      lab.el.style.left = `${((v.x + 1) / 2) * r.width}px`;
      lab.el.style.top = `${((1 - v.y) / 2) * r.height}px`;
      this.labels.append(lab.el);
    }
    this.pending = [];
    this.lastMs = performance.now() - t0;
  }

  private pending: { p: THREE.Vector3; el: HTMLElement }[] = [];
  private label(p: THREE.Vector3, text: string, color: string) {
    const e = document.createElement('div');
    e.className = 'lbl3d';
    e.textContent = text;
    e.style.color = color;
    this.pending.push({ p, el: e });
  }
  private addBeam(z: number, x: number) {
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(x, 0, z + 8), 8, 0xffd23f, 2.2, 1.2);
    this.decor.add(arrow);
    this.label(new THREE.Vector3(x, 0, z + 9), 'e⁻', '#ffd23f');
  }
}
