// Real-space phase image by Fourier synthesis of the slab-filtered crystal potential.
// phi(x, y) = sigma * sum_g V_g * L(g_perp) * D(g_z) * exp(2 pi i g_perp . r), with
//   depth sum : D = T sinc(T g_z) exp(-i pi g_z T)          (slab from depth 0 to T)
//   MEP slice : D = dz sinc(dz g_z) exp(-2 pi^2 sz^2 g_z^2) exp(-2 pi i g_z z0)
// Lab z points to the gun, so depth zeta is z = -zeta. Exact for a perfect crystal slab; this is
// where tilt-induced column smearing (t tan(theta)) comes from.
import { Store } from '../ui/state';
import { compile, uniforms, FULLSCREEN_VS, fullscreenVAO, DataTexture, FloatTarget, GLSL_FETCH, GLSL_COLORMAPS, COLORMAP_IDS, getGL } from './gl';
import { sigmaInteraction, VOLT_A2 } from '../physics/constants';
import { lateralTransfer, sinc } from '../physics/transfer';
import { overlay2D, fmt } from '../ui/util';

const SYNTH_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
uniform sampler2D uC;
uniform int uN;
uniform float uFov;
out vec4 o;
${GLSL_FETCH}
void main() {
  vec2 r = (v_uv - 0.5) * uFov;
  float v = 0.0;
  for (int i = 0; i < uN; i++) {
    vec4 c = fetch4(uC, i);
    v += c.z * cos(6.283185307179586 * dot(c.xy, r) + c.w);
  }
  o = vec4(v, 0.0, 0.0, 1.0);
}`;

const SHOW_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D uImg;
uniform float uLo, uHi;
uniform int uCmap;
out vec4 o;
${GLSL_COLORMAPS}
void main() {
  float v = texture(uImg, v_uv).r;
  o = vec4(colormap(uCmap, (v - uLo) / max(uHi - uLo, 1e-9)), 1.0);
}`;

const N_PIX = 256;
const MAX_COEF = 4096;

export class ImageView {
  dirty = true;
  private gl: WebGL2RenderingContext;
  private synth: WebGLProgram;
  private show: WebGLProgram;
  private u1: ReturnType<typeof uniforms>;
  private u2: ReturnType<typeof uniforms>;
  private vao1: WebGLVertexArrayObject;
  private vao2: WebGLVertexArrayObject;
  private coefTex: DataTexture;
  private target: FloatTarget;
  private readBuf = new Float32Array(N_PIX * N_PIX * 4);
  range: [number, number] = [0, 1];
  nCoef = 0;
  lastMs = 0;

  constructor(private store: Store, readonly mode: 'sum' | 'slice', readonly canvas: HTMLCanvasElement, readonly over: HTMLCanvasElement) {
    const gl = (this.gl = getGL(canvas));
    this.synth = compile(gl, FULLSCREEN_VS, SYNTH_FS);
    this.show = compile(gl, FULLSCREEN_VS, SHOW_FS);
    this.u1 = uniforms(gl, this.synth);
    this.u2 = uniforms(gl, this.show);
    this.vao1 = fullscreenVAO(gl, this.synth);
    this.vao2 = fullscreenVAO(gl, this.show);
    this.coefTex = new DataTexture(gl);
    this.target = new FloatTarget(gl);
    this.target.resize(N_PIX, N_PIX);
    gl.bindTexture(gl.TEXTURE_2D, this.target.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    canvas.width = canvas.height = 512;
  }

  /** Fourier coefficients (lab frame): [gx, gy, amplitude (rad), phase]. Friedel halves, x2. */
  coefficients(): { data: Float32Array; n: number } {
    const s = this.store, p = s.p;
    const R = s.refl();
    const rot = s.R();
    const sig = sigmaInteraction(p.kV);
    const vk = (VOLT_A2 / s.crystal.lattice.volume) * sig * 2;
    const T = p.thickness * 10, dz = p.sliceThickness * 10, z0 = p.sliceDepth * 10;
    const sz = (p.depthRes * 10) / 2.354820045;
    const list: number[][] = [];
    let amax = 0;
    for (let i = 0; i < R.n; i++) {
      const h = R.hkl[3 * i], k = R.hkl[3 * i + 1], l = R.hkl[3 * i + 2];
      if (h < 0 || (h === 0 && (k < 0 || (k === 0 && l < 0)))) continue; // Friedel half
      const gx = R.g[3 * i], gy = R.g[3 * i + 1], gzc = R.g[3 * i + 2];
      const ax = rot[0] * gx + rot[1] * gy + rot[2] * gzc;
      const ay = rot[3] * gx + rot[4] * gy + rot[5] * gzc;
      const az = rot[6] * gx + rot[7] * gy + rot[8] * gzc;
      const lat = lateralTransfer(Math.hypot(ax, ay), p.lateralRes);
      if (lat < 1e-4) continue;
      let dm: number, dph: number;
      if (this.mode === 'sum') {
        dm = T * sinc(T * az);
        dph = -Math.PI * az * T;
      } else {
        dm = dz * sinc(dz * az) * Math.exp(-2 * Math.PI * Math.PI * sz * sz * az * az);
        dph = -2 * Math.PI * az * z0;
      }
      const amp = vk * lat * dm;
      const a = Math.abs(amp) * Math.hypot(R.Fre[i], R.Fim[i]);
      if (a < 1e-7) continue;
      const ph = Math.atan2(R.Fim[i], R.Fre[i]) + dph + (amp < 0 ? Math.PI : 0);
      list.push([ax, ay, a, ph]);
      amax = Math.max(amax, a);
    }
    const kept = list.filter((c) => c[2] > amax * 1e-4).sort((a, b) => b[2] - a[2]).slice(0, MAX_COEF);
    const data = new Float32Array(4 * Math.max(1, kept.length));
    kept.forEach((c, i) => data.set(c, 4 * i));
    return { data, n: kept.length };
  }

  render() {
    const t0 = performance.now();
    this.dirty = false;
    const gl = this.gl, p = this.store.p;
    const { data, n } = this.coefficients();
    this.nCoef = n;
    this.coefTex.upload(data, Math.max(1, n));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, N_PIX, N_PIX);
    gl.useProgram(this.synth);
    this.coefTex.bind(0, this.u1('uC'));
    gl.uniform1i(this.u1('uN'), n);
    gl.uniform1f(this.u1('uFov'), p.imgFov);
    gl.bindVertexArray(this.vao1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (p.imgAuto || this.range[1] <= this.range[0]) {
      gl.readPixels(0, 0, N_PIX, N_PIX, gl.RGBA, gl.FLOAT, this.readBuf);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < this.readBuf.length; i += 4) {
        const v = this.readBuf[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      this.range = hi > lo ? [lo, hi] : [lo - 1e-3, lo + 1e-3];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.show);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.target.tex);
    gl.uniform1i(this.u2('uImg'), 0);
    gl.uniform1f(this.u2('uLo'), this.range[0]);
    gl.uniform1f(this.u2('uHi'), this.range[1]);
    gl.uniform1i(this.u2('uCmap'), COLORMAP_IDS[p.imgCmap] ?? 0);
    gl.bindVertexArray(this.vao2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.drawOverlay();
    this.lastMs = performance.now() - t0;
  }

  private drawOverlay() {
    const p = this.store.p;
    const ctx = overlay2D(this.over);
    const r = this.over.getBoundingClientRect();
    const sc = r.width / p.imgFov;
    const target = p.imgFov * 0.25;
    const nice = [1, 2, 5, 10, 20, 50].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(10, r.height - 12);
    ctx.lineTo(10 + nice * sc, r.height - 12);
    ctx.stroke();
    ctx.font = '11px ui-monospace, monospace';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText(`${nice} Å`, 10, r.height - 18);
    ctx.textAlign = 'right';
    const span = this.range[1] - this.range[0];
    ctx.fillText(`${p.imgAuto ? 'auto' : 'locked'} ${fmt(span, span < 0.1 ? 3 : 2)} rad p-p`, r.width - 8, r.height - 10);
    if (this.mode === 'slice') {
      ctx.textAlign = 'left';
      ctx.fillText(`z = ${fmt(p.sliceDepth, 1)} nm, Δz = ${fmt(p.sliceThickness, 1)} nm`, 8, 16);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(`t = ${fmt(p.thickness, 1)} nm`, 8, 16);
    }
    ctx.shadowBlur = 0;
  }
}
