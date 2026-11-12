// Real-space phase image by Fourier synthesis of the slab-filtered crystal potential; the
// coefficients come from physics/image.ts (imageCoefficients).
import { Store } from '../ui/state';
import { compile, uniforms, FULLSCREEN_VS, fullscreenVAO, DataTexture, FloatTarget, GLSL_FETCH, GLSL_COLORMAPS, COLORMAP_IDS, getGL, fitCanvas } from './gl';
import { imageCoefficients } from '../physics/image';
import { overlay2D, fmt } from '../ui/util';

const SYNTH_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
uniform sampler2D uC;
uniform int uN;
uniform vec2 uFov; // field of view (A) along x and y
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

const N_PIX = 256; // synthesis grid along the shorter side; the longer side follows the panel aspect
const MAX_ASPECT = 2.5;

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
  private readBuf = new Float32Array(Math.ceil(N_PIX * MAX_ASPECT) * N_PIX * 4);
  private nx = N_PIX;
  private ny = N_PIX;
  range: [number, number] = [0, 1];
  nCoef = 0;
  lastMs = 0;
  /** last render time per mode (ms), for the info panel and benchmarks */
  msBy: Record<'sum' | 'slice', number> = { sum: 0, slice: 0 };
  get mode(): 'sum' | 'slice' {
    return this.store.p.imgMode;
  }

  constructor(private store: Store, readonly canvas: HTMLCanvasElement, readonly over: HTMLCanvasElement) {
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
  }

  /** Fourier coefficients (lab frame): [gx, gy, amplitude (rad), phase]. Friedel halves, x2. */
  coefficients(): { data: Float32Array; n: number } {
    const s = this.store;
    return imageCoefficients(s.refl(), s.R(), s.crystal.lattice.volume, s.p.kV, s.transfer(this.mode));
  }

  render() {
    const t0 = performance.now();
    this.dirty = false;
    const gl = this.gl, p = this.store.p;
    const [W, H] = fitCanvas(this.canvas, 1024);
    // synthesis grid with the panel's aspect ratio; imgFov spans the shorter side
    const asp = Math.min(MAX_ASPECT, Math.max(1 / MAX_ASPECT, W / H));
    const nx = asp >= 1 ? Math.round(N_PIX * asp) : N_PIX, ny = asp >= 1 ? N_PIX : Math.round(N_PIX / asp);
    if (nx !== this.nx || ny !== this.ny) {
      this.nx = nx;
      this.ny = ny;
      this.target.resize(nx, ny);
      gl.bindTexture(gl.TEXTURE_2D, this.target.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    const fx = asp >= 1 ? p.imgFov * asp : p.imgFov, fy = asp >= 1 ? p.imgFov : p.imgFov / asp;
    const { data, n } = this.coefficients();
    this.nCoef = n;
    this.coefTex.upload(data, Math.max(1, n));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, nx, ny);
    gl.useProgram(this.synth);
    this.coefTex.bind(0, this.u1('uC'));
    gl.uniform1i(this.u1('uN'), n);
    gl.uniform2f(this.u1('uFov'), fx, fy);
    gl.bindVertexArray(this.vao1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (p.imgAuto || this.range[1] <= this.range[0]) {
      gl.readPixels(0, 0, nx, ny, gl.RGBA, gl.FLOAT, this.readBuf);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0, m = 4 * nx * ny; i < m; i += 4) {
        const v = this.readBuf[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      this.range = hi > lo ? [lo, hi] : [lo - 1e-3, lo + 1e-3];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
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
    this.msBy[this.mode] = this.lastMs;
  }

  private drawOverlay() {
    const p = this.store.p;
    const ctx = overlay2D(this.over);
    const r = this.over.getBoundingClientRect();
    const sc = Math.min(r.width, r.height) / p.imgFov;
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
