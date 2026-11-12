// Thin WebGL2 helpers shared by the shader panels.

export function getGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is not available in this browser');
  return gl;
}

export function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      console.error(numbered);
      throw new Error('shader compile failed: ' + log);
    }
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link failed: ' + gl.getProgramInfoLog(p));
  return p;
}

/** Uniform location cache. */
export function uniforms(gl: WebGL2RenderingContext, p: WebGLProgram) {
  const cache = new Map<string, WebGLUniformLocation | null>();
  return (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
    return cache.get(name)!;
  };
}

/** Full-screen triangle; vertex shader gets a_pos in [-1, 1]. */
export const FULLSCREEN_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export function fullscreenVAO(gl: WebGL2RenderingContext, prog: WebGLProgram): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export const TEX_W = 1024;

/** RGBA32F data texture, TEX_W wide, read in GLSL with fetch4(tex, i). */
export class DataTexture {
  tex: WebGLTexture;
  rows = 0;
  constructor(private gl: WebGL2RenderingContext) {
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  /** data: 4 floats per item. */
  upload(data: Float32Array, count: number) {
    const gl = this.gl;
    const rows = Math.max(1, Math.ceil(count / TEX_W));
    const need = rows * TEX_W * 4;
    let buf = data;
    if (data.length < need) {
      buf = new Float32Array(need);
      buf.set(data.subarray(0, Math.min(data.length, need)));
    } else if (data.length > need) buf = data.subarray(0, need);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (rows !== this.rows) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, rows, 0, gl.RGBA, gl.FLOAT, buf);
      this.rows = rows;
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, rows, gl.RGBA, gl.FLOAT, buf);
  }
  bind(unit: number, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(loc, unit);
  }
}

export const GLSL_FETCH = `
vec4 fetch4(sampler2D t, int i) { return texelFetch(t, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0); }
`;

/** Float render target (needs EXT_color_buffer_float, universally present on WebGL2 desktop/mobile GPUs). */
export class FloatTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w = 0;
  h = 0;
  readonly ok: boolean;
  constructor(private gl: WebGL2RenderingContext) {
    this.ok = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.fbo = gl.createFramebuffer()!;
    this.tex = gl.createTexture()!;
  }
  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.ok) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

/** Size a canvas's drawing buffer to its CSS box (capped), return [w, h]. */
export function fitCanvas(c: HTMLCanvasElement, maxPx = 1024, scale = 1): [number, number] {
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
  const r = c.getBoundingClientRect();
  const w = Math.max(16, Math.min(maxPx, Math.round(r.width * dpr)));
  const h = Math.max(16, Math.min(maxPx, Math.round(r.height * dpr)));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return [w, h];
}

// Polynomial colormap fits (viridis / inferno / magma: Matt Zucker, CC0; turbo: Google, Apache-2.0).
export const GLSL_COLORMAPS = `
vec3 cm_viridis(float t) {
  const vec3 c0 = vec3(0.2777273272234177, 0.005407344544966578, 0.3340998053353061);
  const vec3 c1 = vec3(0.1050930431085774, 1.404613529898575, 1.384590162594685);
  const vec3 c2 = vec3(-0.3308618287255563, 0.214847559468213, 0.09509516302823659);
  const vec3 c3 = vec3(-4.634230498983486, -5.799100973351585, -19.33244095627987);
  const vec3 c4 = vec3(6.228269936347081, 14.17993336680509, 56.69055260068105);
  const vec3 c5 = vec3(4.776384997670288, -13.74514537774601, -65.35303263337234);
  const vec3 c6 = vec3(-5.435455855934631, 4.645852612178535, 26.3124352495832);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
vec3 cm_inferno(float t) {
  const vec3 c0 = vec3(0.0002189403691192265, 0.001651004631001012, -0.01948089843709184);
  const vec3 c1 = vec3(0.1065134194856116, 0.5639564367884091, 3.932712388889277);
  const vec3 c2 = vec3(11.60249308247187, -3.972853965665698, -15.9423941062914);
  const vec3 c3 = vec3(-41.70399613139459, 17.43639888205313, 44.35414519872813);
  const vec3 c4 = vec3(77.162935699427, -33.40235894210092, -81.80730925738993);
  const vec3 c5 = vec3(-71.31942824499214, 32.62606426397723, 73.20951985803202);
  const vec3 c6 = vec3(25.13112622477341, -12.24266895238567, -23.07032500287172);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
vec3 cm_magma(float t) {
  const vec3 c0 = vec3(-0.002136485053939582, -0.000749655052795221, -0.005386127855323933);
  const vec3 c1 = vec3(0.2516605407371642, 0.6775232436837668, 2.494026599312351);
  const vec3 c2 = vec3(8.353717279216625, -3.577719514958484, 0.3144679030132573);
  const vec3 c3 = vec3(-27.66873308576866, 14.26473078096533, -13.64921318813922);
  const vec3 c4 = vec3(52.17613981234068, -27.94360607168351, 12.94416944238394);
  const vec3 c5 = vec3(-50.76852536473588, 29.04658282127291, 4.23415299384598);
  const vec3 c6 = vec3(18.65570506591883, -11.48977351997711, -5.601961508734096);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
vec3 cm_turbo(float x) {
  const vec4 kR = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kG = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kB = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kR2 = vec2(-152.94239396, 59.28637943);
  const vec2 kG2 = vec2(4.27729857, 2.82956604);
  const vec2 kB2 = vec2(-89.90310912, 27.34824973);
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(dot(v4, kR) + dot(v2, kR2), dot(v4, kG) + dot(v2, kG2), dot(v4, kB) + dot(v2, kB2));
}
vec3 colormap(int id, float t) {
  t = clamp(t, 0.0, 1.0);
  if (id == 1) return cm_inferno(t);
  if (id == 2) return cm_viridis(t);
  if (id == 3) return cm_magma(t);
  if (id == 4) return cm_turbo(t);
  return vec3(t);
}
`;
export const COLORMAP_IDS: Record<string, number> = { gray: 0, inferno: 1, viridis: 2, magma: 3, turbo: 4 };

// JS copies of the polynomial colormaps (for 2D overlays and legends).
const POLY: Record<string, number[][]> = {
  viridis: [[0.2777273272234177, 0.005407344544966578, 0.3340998053353061], [0.1050930431085774, 1.404613529898575, 1.384590162594685], [-0.3308618287255563, 0.214847559468213, 0.09509516302823659], [-4.634230498983486, -5.799100973351585, -19.33244095627987], [6.228269936347081, 14.17993336680509, 56.69055260068105], [4.776384997670288, -13.74514537774601, -65.35303263337234], [-5.435455855934631, 4.645852612178535, 26.3124352495832]],
  inferno: [[0.0002189403691192265, 0.001651004631001012, -0.01948089843709184], [0.1065134194856116, 0.5639564367884091, 3.932712388889277], [11.60249308247187, -3.972853965665698, -15.9423941062914], [-41.70399613139459, 17.43639888205313, 44.35414519872813], [77.162935699427, -33.40235894210092, -81.80730925738993], [-71.31942824499214, 32.62606426397723, 73.20951985803202], [25.13112622477341, -12.24266895238567, -23.07032500287172]],
  magma: [[-0.002136485053939582, -0.000749655052795221, -0.005386127855323933], [0.2516605407371642, 0.6775232436837668, 2.494026599312351], [8.353717279216625, -3.577719514958484, 0.3144679030132573], [-27.66873308576866, 14.26473078096533, -13.64921318813922], [52.17613981234068, -27.94360607168351, 12.94416944238394], [-50.76852536473588, 29.04658282127291, 4.23415299384598], [18.65570506591883, -11.48977351997711, -5.601961508734096]],
};
export function cmapCSS(name: string, t: number): string {
  t = Math.min(1, Math.max(0, t));
  let rgb: number[];
  if (name === 'turbo') {
    const v4 = [1, t, t * t, t * t * t];
    const v2 = [t * t * t * t, t * t * t * t * t];
    const d = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    rgb = [
      d(v4, [0.13572138, 4.6153926, -42.66032258, 132.13108234]) + d(v2, [-152.94239396, 59.28637943]),
      d(v4, [0.09140261, 2.19418839, 4.84296658, -14.18503333]) + d(v2, [4.27729857, 2.82956604]),
      d(v4, [0.1066733, 12.64194608, -60.58204836, 110.36276771]) + d(v2, [-89.90310912, 27.34824973]),
    ];
  } else if (POLY[name]) {
    const c = POLY[name];
    rgb = [0, 1, 2].map((j) => c.reduceRight((acc, ci) => acc * t + ci[j], 0));
  } else rgb = [t, t, t];
  const h = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x)));
  return `rgb(${h(rgb[0])},${h(rgb[1])},${h(rgb[2])})`;
}
