// Diffraction pattern panel.
// Pass 1 (instanced quads, additive into a float target): one quad per excited reflection.
//   Parallel beam: Gaussian spot with the CPU intensity. Convergent beam: a disk of radius alpha*K;
//   every pixel is its own incident direction t = q - g_xy, so the per-reflection two-beam (or
//   kinematic) rocking curve is evaluated per pixel; the 000 disk is 1 - sum_g I_g(t), which draws
//   the HOLZ deficit lines.
// Pass 2 (full screen): Kikuchi bands from the strongest planes + diffuse background, log tone map.
import { Store } from '../ui/state';
import { compile, uniforms, FULLSCREEN_VS, fullscreenVAO, DataTexture, FloatTarget, GLSL_FETCH, GLSL_COLORMAPS, COLORMAP_IDS, getGL, fitCanvas } from './gl';
import { excitationError, twoBeamIntensity, kinematicIntensity, beamMode } from '../physics/diffraction';
import { blochIntensities, selectBlochBeams } from '../physics/bloch';
import { Vec3, normalize, matVec, transpose, overlay2D, fmt, cssVar, DEG } from '../ui/util';
import { rotationAtoB } from '../physics/orientation';
import { nearestZones, dirIdx, planeIdx } from '../physics/zones';
import { drawIdx } from './label';

const SPOT_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_g;   // g lab (gx, gy, gz), 1/xi
layout(location=2) in vec2 a_I;   // parallel-beam intensity, kind (1 = transmitted)
uniform float uScale;  // px per 1/A
uniform vec2 uRes;
uniform vec2 uPan;     // view centre in 1/A
uniform float uHalf;   // quad half size (1/A)
out vec2 v_q;
flat out vec4 v_g;
flat out vec2 v_I;
void main() {
  vec2 q = a_g.xy + a_corner * uHalf;
  v_q = q; v_g = a_g; v_I = a_I;
  gl_Position = vec4((q - uPan) * uScale / (0.5 * uRes), 0.0, 1.0);
}`;

const SPOT_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_q;
flat in vec4 v_g;
flat in vec2 v_I;
uniform int uCBED;
uniform int uTheory;    // 0 kinematic, 1 two-beam, 2 Bloch (per-beam constant)
uniform float uK, uT, uRd, uSigma, uScale;
uniform sampler2D uRefl;
uniform int uNRefl;
out vec4 o;
const float PI = 3.141592653589793;
${GLSL_FETCH}
float sExc(vec3 g, vec2 t) {
  float kz = -sqrt(max(uK * uK - dot(t, t), 0.0));
  return -(2.0 * (dot(t, g.xy) + kz * g.z) + dot(g, g)) / (2.0 * uK);
}
float inten(float s, float ix) {
  if (uTheory == 0) {
    float x = PI * uT * s;
    float sc = abs(x) < 1e-5 ? 1.0 : sin(x) / x;
    float a = PI * uT * ix;
    return a * a * sc * sc;
  }
  float se = sqrt(s * s + ix * ix);
  float v = sin(PI * uT * se) * ix / se;
  return v * v;
}
void main() {
  if (uCBED == 0) {
    vec2 d = (v_q - v_g.xy) * uScale;
    o = vec4(v_I.x * exp(-dot(d, d) / (2.0 * uSigma * uSigma)), 0.0, 0.0, 1.0);
    return;
  }
  vec2 t = v_q - v_g.xy;
  float r = length(t);
  float edge = clamp((uRd - r) * uScale + 0.5, 0.0, 1.0);
  if (edge <= 0.0) discard;
  float I;
  if (uTheory == 2) I = v_I.x;
  else if (v_I.y > 0.5) {
    float sum = 0.0;
    for (int i = 0; i < uNRefl; i++) {
      vec4 g = fetch4(uRefl, i);
      sum += inten(sExc(g.xyz, t), g.w);
    }
    I = exp(-sum); // = 1 - sum to first order, stays positive when independent two-beam sums exceed 1
  } else I = inten(sExc(v_g.xyz, t), v_g.w);
  o = vec4(I * edge, 0.0, 0.0, 1.0);
}`;

const COMP_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
uniform sampler2D uSpots, uKik;
uniform int uNKik, uCmap, uDisp;
uniform float uKikStr, uScale, uK, uDecades, uLw, uGain;
uniform vec2 uRes, uPan;
out vec4 o;
${GLSL_FETCH}
${GLSL_COLORMAPS}
void main() {
  vec2 q = (v_uv - 0.5) * uRes / uScale + uPan;
  float I = texture(uSpots, v_uv).r;
  float q2 = dot(q, q);
  float total = I;
  if (uKikStr > 0.0) {
    vec3 k = vec3(q, -sqrt(max(uK * uK - q2, 0.0)));
    float kik = 0.0;
    for (int j = 0; j < uNKik; j++) {
      vec4 a = fetch4(uKik, 2 * j);
      vec4 b = fetch4(uKik, 2 * j + 1);
      float h = 0.5 * a.w;
      float x = dot(k, a.xyz);
      float x0 = -uK * a.z;
      float c = clamp(x0 / h, -1.0, 1.0);
      float ep = 0.5 * (1.0 - c), em = 0.5 * (1.0 + c);
      float lp = exp(-(x - h) * (x - h) / (2.0 * uLw * uLw));
      float lm = exp(-(x + h) * (x + h) / (2.0 * uLw * uLw));
      float band = smoothstep(h + uLw, h - uLw, abs(x));
      kik += b.x * (0.22 * band + 0.9 * (ep * lp + em * lm) - 0.55 * ((1.0 - ep) * lp + (1.0 - em) * lm));
    }
    float bg = uKikStr * 0.006 / (1.0 + q2 / 2.0);
    total += max(bg * (1.0 + kik), 0.0);
  }
  float v;
  if (uDisp == 1) v = pow(clamp(total * uGain, 0.0, 1.0), 0.5);
  else {
    float eps = pow(10.0, -uDecades);
    v = log(1.0 + total / eps) / log(1.0 + 1.0 / eps);
  }
  o = vec4(colormap(uCmap, v), 1.0);
}`;

const MAX_INST = 20000;
const MAX_KIK = 64;

export class DPView {
  dirty = true;
  private gl: WebGL2RenderingContext;
  private spotProg: WebGLProgram;
  private compProg: WebGLProgram;
  private uS: ReturnType<typeof uniforms>;
  private uC: ReturnType<typeof uniforms>;
  private vao: WebGLVertexArrayObject;
  private fsVao: WebGLVertexArrayObject;
  private instBuf: WebGLBuffer;
  private inst = new Float32Array(MAX_INST * 6);
  nInst = 0;
  private target: FloatTarget;
  private kikTex: DataTexture;
  private reflTex: DataTexture;
  private kikKey = '';
  private kikPlanes: { g: Vec3; gabs: number; w: number }[] = [];
  /** visible spots for labels: [qx, qy, I, reflIndex] */
  private labels: number[][] = [];
  private bloch = { ver: -1, key: '', I: new Map<number, number>(), I0: 1, ms: 0, n: 0 };
  private blochTimer = 0;
  pan: [number, number] = [0, 0];
  /** true when the last frame drew CBED disks (automatic from the convergence angle and zoom) */
  cbed = false;
  lastMs = 0;
  onNeedRender: () => void = () => {};

  constructor(private store: Store, readonly canvas: HTMLCanvasElement, readonly over: HTMLCanvasElement) {
    const gl = (this.gl = getGL(canvas));
    this.spotProg = compile(gl, SPOT_VS, SPOT_FS);
    this.compProg = compile(gl, FULLSCREEN_VS, COMP_FS);
    this.uS = uniforms(gl, this.spotProg);
    this.uC = uniforms(gl, this.compProg);
    this.fsVao = fullscreenVAO(gl, this.compProg);
    this.target = new FloatTarget(gl);
    this.kikTex = new DataTexture(gl);
    this.reflTex = new DataTexture(gl);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  /** px per 1/A for the current canvas. */
  scale(): number {
    const r = this.canvas.getBoundingClientRect();
    return Math.min(r.width, r.height) / 2 / this.store.p.dpRange;
  }
  /** CSS-pixel position (relative to canvas) -> q (1/A). */
  toQ(x: number, y: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const s = this.scale();
    return [(x - r.width / 2) / s + this.pan[0], -(y - r.height / 2) / s + this.pan[1]];
  }
  /** Lab direction of a zone axis whose Kikuchi centre is at q. */
  dirAtQ(q: [number, number]): Vec3 {
    const K = this.store.K;
    const dx = -q[0] / K, dy = -q[1] / K;
    return [dx, dy, Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy))];
  }
  /** Drag: the Kikuchi pattern follows the pointer. */
  drag(q1: [number, number], q2: [number, number]) {
    this.store.applyLabRotation(rotationAtoB(this.dirAtQ(q1), this.dirAtQ(q2)));
  }

  private kikuchiPlanes() {
    const s = this.store;
    const key = `${s.p.crystal}|${s.p.kV}|${s.p.dw}`;
    if (key === this.kikKey) return;
    this.kikKey = key;
    const R = s.refl();
    const seen = new Set<string>();
    const cand: { g: Vec3; gabs: number; w: number }[] = [];
    for (let i = 0; i < R.n && R.gabs[i] < 2.0; i++) {
      if (!R.allowed[i]) continue;
      const h = [R.hkl[3 * i], R.hkl[3 * i + 1], R.hkl[3 * i + 2]];
      const neg = h.map((x) => -x).join(',');
      if (seen.has(neg)) continue;
      seen.add(h.join(','));
      cand.push({ g: [R.g[3 * i], R.g[3 * i + 1], R.g[3 * i + 2]], gabs: R.gabs[i], w: R.U[i] });
    }
    cand.sort((a, b) => b.w - a.w);
    const top = cand.slice(0, MAX_KIK);
    const wmax = top.length ? top[0].w : 1;
    for (const c of top) c.w = Math.pow(c.w / wmax, 0.7);
    this.kikPlanes = top;
  }

  private scheduleBloch() {
    if (this.blochTimer) return;
    this.blochTimer = window.setTimeout(() => {
      this.blochTimer = 0;
      if (this.store.interacting) {
        this.scheduleBloch();
        return;
      }
      this.computeBloch();
      this.dirty = true;
      this.onNeedRender();
    }, 90);
  }
  private blochKey() {
    const p = this.store.p;
    return `${p.crystal}|${p.kV}|${p.thickness}|${p.blochBeams}|${p.dpRange}|${p.dw}`;
  }
  private computeBloch() {
    const s = this.store;
    const t0 = performance.now();
    const R = s.refl();
    const rot = s.R();
    const K = s.K;
    const idx = selectBlochBeams(R, rot, K, s.p.blochBeams, Math.min(R.gmax, s.p.dpRange * 1.6), 0.08);
    const hkls: number[][] = [[0, 0, 0]];
    const gLab: number[][] = [[0, 0, 0]];
    for (const i of idx) {
      hkls.push([R.hkl[3 * i], R.hkl[3 * i + 1], R.hkl[3 * i + 2]]);
      gLab.push(matVec(rot, [R.g[3 * i], R.g[3 * i + 1], R.g[3 * i + 2]]));
    }
    const I = blochIntensities(s.crystal, hkls, gLab, s.p.kV, s.p.thickness * 10);
    const m = new Map<number, number>();
    idx.forEach((ri, k) => m.set(ri, I[k + 1]));
    this.bloch = { ver: s.orientVersion, key: this.blochKey(), I: m, I0: I[0], ms: performance.now() - t0, n: hkls.length };
  }
  blochStatus(): string {
    if (this.store.p.dpTheory !== 'bloch') return '';
    const fresh = this.bloch.ver === this.store.orientVersion && this.bloch.key === this.blochKey();
    return fresh ? `Bloch ${this.bloch.n} beams, ${this.bloch.ms.toFixed(0)} ms` : 'Bloch: updating (two-beam preview)';
  }

  render() {
    const t0 = performance.now();
    this.dirty = false;
    const s = this.store, p = s.p, gl = this.gl;
    const [W, H] = fitCanvas(this.canvas, 1100);
    this.target.resize(W, H);
    this.kikuchiPlanes();
    const R = s.refl();
    const rot = s.R();
    const K = s.K;
    const T = p.thickness * 10;
    const scaleCss = this.scale();
    const dpr = W / this.canvas.getBoundingClientRect().width;
    const scalePx = scaleCss * dpr;
    const sigmaPx = p.dpSpot * (W / 512);
    // one convergence angle: CBED disks once they are larger than the spot blur, else spots
    const mode = beamMode(p.convAlpha, K, scalePx, sigmaPx);
    const cbed = mode.cbed;
    const rd = cbed ? mode.rd : 0;
    this.cbed = cbed;
    const view = p.dpRange * 1.45 + rd + Math.hypot(...this.pan);

    // Bloch cache
    let useBloch = false;
    if (p.dpTheory === 'bloch') {
      if (this.bloch.ver === s.orientVersion && this.bloch.key === this.blochKey()) useBloch = true;
      else this.scheduleBloch();
    }
    const theory = useBloch ? 2 : p.dpTheory === 'kinematic' ? 0 : 1;

    // ---- per-reflection CPU pass ------------------------------------------------------------
    const inst = this.inst;
    let n = 0;
    let sumI = 0;
    let maxI = 0;
    const floorI = Math.pow(10, -p.dpDecades - 0.5);
    const reflData: number[] = [];
    this.labels = [];
    for (let i = 0; i < R.n; i++) {
      const gx = R.g[3 * i], gy = R.g[3 * i + 1], gz = R.g[3 * i + 2];
      const g: Vec3 = [
        rot[0] * gx + rot[1] * gy + rot[2] * gz,
        rot[3] * gx + rot[4] * gy + rot[5] * gz,
        rot[6] * gx + rot[7] * gy + rot[8] * gz,
      ];
      const ix = 1 / R.xi[i];
      if (!(ix > 0)) continue;
      const sg = excitationError(g, K);
      let I: number;
      if (useBloch) I = this.bloch.I.get(i) ?? 0;
      else I = theory === 0 ? kinematicIntensity(sg, R.xi[i], T) : twoBeamIntensity(sg, R.xi[i], T);
      sumI += I;
      const gxy = Math.hypot(g[0], g[1]);
      if (cbed) {
        const sMin = Math.max(0, Math.abs(sg) - p.convAlpha * 1e-3 * gxy);
        const sCut = 3 / T + 3 * ix;
        if (sMin > sCut) continue;
        if (reflData.length < 4 * 2048) reflData.push(g[0], g[1], g[2], ix);
        if (gxy > view) continue;
      } else {
        if (I < floorI || gxy > view) continue;
      }
      if (n >= MAX_INST - 1) break;
      inst.set([g[0], g[1], g[2], ix, I, 0], 6 * n);
      if (I > maxI) maxI = I;
      n++;
      if (I > floorI * 10) this.labels.push([g[0], g[1], I, i]);
    }
    const I0 = useBloch ? this.bloch.I0 : Math.exp(-sumI);
    inst.set([0, 0, 0, 0, I0, 1], 6 * n);
    n++;
    this.nInst = n;

    // ---- pass 1: spots / disks ---------------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.spotProg);
    const u = this.uS;
    gl.uniform1f(u('uScale'), scalePx);
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform2f(u('uPan'), this.pan[0], this.pan[1]);
    gl.uniform1f(u('uHalf'), cbed ? rd + 2 / scalePx : (3.5 * sigmaPx) / scalePx);
    gl.uniform1i(u('uCBED'), cbed ? 1 : 0);
    gl.uniform1i(u('uTheory'), theory);
    gl.uniform1f(u('uK'), K);
    gl.uniform1f(u('uT'), T);
    gl.uniform1f(u('uRd'), rd);
    gl.uniform1f(u('uSigma'), sigmaPx);
    const nRefl = reflData.length / 4;
    this.reflTex.upload(new Float32Array(reflData), Math.max(1, nRefl));
    this.reflTex.bind(0, u('uRefl'));
    gl.uniform1i(u('uNRefl'), nRefl);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, 6 * n));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);

    // ---- pass 2: Kikuchi + tone map -----------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.compProg);
    const c = this.uC;
    const kd = new Float32Array(8 * this.kikPlanes.length + 8);
    this.kikPlanes.forEach((pl, j) => {
      const gl3 = normalize(matVec(rot, pl.g));
      kd.set([gl3[0], gl3[1], gl3[2], pl.gabs, pl.w, 0, 0, 0], 8 * j);
    });
    this.kikTex.upload(kd, Math.max(1, 2 * this.kikPlanes.length));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.target.tex);
    gl.uniform1i(c('uSpots'), 0);
    this.kikTex.bind(1, c('uKik'));
    gl.uniform1i(c('uNKik'), this.kikPlanes.length);
    gl.uniform1i(c('uCmap'), COLORMAP_IDS[p.dpCmap] ?? 0);
    gl.uniform1f(c('uKikStr'), p.kikuchi);
    gl.uniform1f(c('uScale'), scalePx);
    gl.uniform1f(c('uK'), K);
    gl.uniform1f(c('uDecades'), p.dpDecades);
    gl.uniform1f(c('uGain'), 1 / Math.min(1, Math.max(0.05, maxI, I0)));
    // auto: gamma for separated CBED disks, log for SAED and for overlapping (Ronchigram-like) disks
    let gmin = Infinity;
    for (let i = 0; i < R.n; i++) if (R.allowed[i]) { gmin = R.gabs[i]; break; }
    const overlap = cbed && 2 * rd > gmin; // disks actually overlap (Ronchigram-like)
    gl.uniform1i(c('uDisp'), p.dpDisplay === 'gamma' || (p.dpDisplay === 'auto' && cbed && !overlap) ? 1 : 0);
    gl.uniform1f(c('uLw'), Math.max(1.2 / scalePx, 0.004));
    gl.uniform2f(c('uRes'), W, H);
    gl.uniform2f(c('uPan'), this.pan[0], this.pan[1]);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.drawOverlay();
    this.lastMs = performance.now() - t0;
  }

  private drawOverlay() {
    const s = this.store, p = s.p;
    const ctx = overlay2D(this.over);
    const r = this.over.getBoundingClientRect();
    const sc = this.scale();
    const X = (q: number) => r.width / 2 + (q - this.pan[0]) * sc;
    const Y = (q: number) => r.height / 2 - (q - this.pan[1]) * sc;
    const accent = cssVar('--accent') || '#4cc9f0';
    const R = s.refl();
    const L = s.crystal.lattice;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    if (p.dpLabels && !document.body.classList.contains('training')) {
      const lab = this.labels.sort((a, b) => b[2] - a[2]).slice(0, 28);
      ctx.fillStyle = 'rgba(255,220,120,0.85)';
      for (const [qx, qy, , i] of lab) {
        const x = X(qx), y = Y(qy);
        if (x < 10 || y < 10 || x > r.width - 10 || y > r.height - 10) continue;
        drawIdx(ctx, planeIdx(L, [R.hkl[3 * i], R.hkl[3 * i + 1], R.hkl[3 * i + 2]]), x, y - 7, { align: 'center' });
      }
    }
    // nearest zone axis: Kikuchi centre at q = -K d_xy, and the Laue circle of its ZOLZ
    const bc = s.beamCrystal();
    const near = nearestZones(bc, s.zones(), 1, s.zones()[Math.min(s.zones().length - 1, 40)].len)[0];
    if (near && !document.body.classList.contains('training-nohint')) {
      const d = matVec(s.R(), near.zone.dir);
      const qx = -s.K * d[0], qy = -s.K * d[1];
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.lineWidth = 1.5;
      const x = X(qx), y = Y(qy);
      const inside = x > 0 && y > 0 && x < r.width && y < r.height;
      if (near.angle > 0.02 * DEG) {
        const x0 = X(0), y0 = Y(0);
        const len = Math.hypot(x - x0, y - y0);
        const L2 = inside ? len : Math.min(len, Math.min(r.width, r.height) * 0.42);
        const ux = (x - x0) / len, uy = (y - y0) / len;
        const ex = x0 + ux * L2, ey = y0 + uy * L2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 9 * ux + 5 * uy, ey - 9 * uy - 5 * ux);
        ctx.lineTo(ex - 9 * ux - 5 * uy, ey - 9 * uy + 5 * ux);
        ctx.fill();
        if (inside) {
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.textAlign = 'left';
        const lx = Math.min(ex + 8, r.width - 100), ly = Math.max(ey - 8, 14);
        const w = drawIdx(ctx, dirIdx(L, near.zone.uvw), lx, ly, { open: '[', close: ']' });
        ctx.fillText(` ${fmt(near.angle / DEG, 2)}°`, lx + w, ly);
      }
      if (p.dpLaue && near.angle > 0.05 * DEG) {
        const cxq = -s.K * d[2] * d[0], cyq = -s.K * d[2] * d[1];
        ctx.strokeStyle = 'rgba(255,120,120,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(X(cxq), Y(cyq), s.K * Math.hypot(d[0], d[1]) * sc, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    // scale bar: a round number of 1/A, also in mrad
    const target = (r.width * 0.22) / sc;
    const nice = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, r.height - 14);
    ctx.lineTo(12 + nice * sc, r.height - 14);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillText(`${nice} Å⁻¹ = ${fmt(nice * s.lambda * 1e3, 1)} mrad`, 12, r.height - 20);
    ctx.textAlign = 'left';
    ctx.fillText(this.cbed ? `CBED α ${fmt(p.convAlpha, 1)} mrad` : p.convAlpha > 0 ? `α ${fmt(p.convAlpha, 1)} mrad: disks < spot size, drawn as spots` : 'parallel beam', 8, 16);
    const st = this.blochStatus();
    if (st) {
      ctx.textAlign = 'right';
      ctx.fillText(st, r.width - 8, r.height - 10);
    }
    void transpose;
  }
}
