// Beam-centred stereographic map coloured by the projected 2D resolution (same metric as
// physics/transfer.resolution2D, evaluated per pixel on the GPU). The centre is the current beam;
// a point is where that crystal direction would sit if tilted onto the beam, drawn on the same side
// as its Kikuchi centre in the DP. Unreachable orientations (holder limits) are hatched.
import { Store } from '../ui/state';
import { compile, uniforms, FULLSCREEN_VS, fullscreenVAO, DataTexture, GLSL_FETCH, GLSL_COLORMAPS, COLORMAP_IDS, getGL, fitCanvas, cmapCSS } from './gl';
import { stereoForward, stereoInverse } from '../physics/stereo';
import { Mat3, Vec3, matVec, transpose, normalize, cross, overlay2D, fmt, DEG, cssVar } from '../ui/util';
import { rotationAtoB, holderOutline, tiltToBring } from '../physics/orientation';
import { dirIdx, Zone } from '../physics/zones';
import { drawIdx, idxWidth } from './label';
import { ringAngles, placeLabels } from '../ui/layout';
import { zoneCutAngle, passWidth, resolution2D, TAU } from '../physics/transfer';

const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
uniform mat3 uRt, uMount;
uniform float uEdge, uSPass, uDbest, uDworst;
uniform vec2 uRes, uLim;
uniform int uNZ, uCmap;
uniform float uCosCut, uPx;
uniform sampler2D uRefl, uZones;
out vec4 o;
${GLSL_FETCH}
${GLSL_COLORMAPS}
void main() {
  vec2 P = (v_uv - 0.5) * uRes / (0.5 * min(uRes.x, uRes.y)) * uEdge;
  float r2 = dot(P, P);
  if (r2 > 1.0) { o = vec4(0.0); return; }
  float k = 1.0 / (1.0 + r2);
  vec3 d = vec3(-2.0 * P * k, (1.0 - r2) * k);
  vec3 n = uRt * d;
  vec3 ref = abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 e1 = normalize(cross(n, ref));
  vec3 e2 = cross(n, e1);
  float bestH = 0.0;
  float h[18];
  for (int z = 0; z < uNZ; z++) {
    vec4 A = fetch4(uZones, 2 * z);
    if (abs(dot(A.xyz, n)) < uCosCut) continue;
    int start = int(A.w);
    int cnt = int(fetch4(uZones, 2 * z + 1).x);
    for (int k = 0; k < 18; k++) h[k] = 0.0;
    float minH = 0.0;
    for (int j = 0; j < cnt; j++) {
      vec4 g = fetch4(uRefl, start + j);
      if (g.w <= minH || g.w <= bestH) break;
      float s = dot(g.xyz, n);
      if (abs(s) > uSPass) continue;
      float x = dot(g.xyz, e1), y = dot(g.xyz, e2);
      minH = 1e9;
      for (int k = 0; k < 18; k++) {
        float ph = 0.17453292519943295 * float(k);
        h[k] = max(h[k], abs(x * cos(ph) + y * sin(ph)));
        minH = min(minH, h[k]);
      }
    }
    bestH = max(bestH, minH);
  }
  float best = bestH > 0.0 ? 1.0 / bestH : 1e9;
  vec3 col;
  if (best <= uDworst) {
    col = colormap(uCmap, (uDworst - best) / (uDworst - uDbest));
  } else col = vec3(0.07);
  vec3 v = uMount * n;
  float a = asin(clamp(v.y, -1.0, 1.0));
  float b = atan(-v.x, v.z);
  if (uLim.x > 0.0 && (abs(a) > uLim.x || abs(b) > uLim.y)) {
    // beyond the holder range: dimmed, desaturated, red diagonal stripes every 10 css px
    float lum = dot(col, vec3(0.3, 0.55, 0.15));
    col = mix(col, vec3(lum), 0.6) * 0.35;
    float s = mod((gl_FragCoord.x - gl_FragCoord.y) / uPx, 10.0);
    col = mix(col, vec3(0.86, 0.24, 0.22), (s < 2.2 ? 0.8 : 0.0));
  }
  o = vec4(col, 1.0);
}`;

/** GLSL mat3 is column-major. */
const colMajor = (m: Mat3) => new Float32Array(transpose(m));


export class StereoView {
  dirty = true;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: ReturnType<typeof uniforms>;
  private vao: WebGLVertexArrayObject;
  private tex: DataTexture;
  private zsUploaded: unknown = null;
  private zoneTex: DataTexture;
  nZones = 0;
  nRefl = 0;
  lastMs = 0;
  /** screen positions of drawn zone markers, for click-to-go */
  hits: { x: number; y: number; zone: Zone }[] = [];
  /** tilt-ring angles (deg) drawn in the last frame */
  rings: number[] = [];
  /** zones labelled in the last frame (uvw), and the number of outline points drawn */
  labelled: number[][] = [];
  outlinePts = 0;
  /** depth transfer that coloured the last frame (follows the image mode) */
  source: 'sum' | 'slice' = 'sum';
  lowRes = false;
  private onZone = new Map<string, number>();
  private onZoneKey = '';

  constructor(private store: Store, readonly canvas: HTMLCanvasElement, readonly over: HTMLCanvasElement) {
    const gl = (this.gl = getGL(canvas));
    this.prog = compile(gl, FULLSCREEN_VS, FS);
    this.u = uniforms(gl, this.prog);
    this.vao = fullscreenVAO(gl, this.prog);
    this.tex = new DataTexture(gl);
    this.zoneTex = new DataTexture(gl);
  }

  edge() {
    return Math.tan((this.store.p.mapRange * DEG) / 2);
  }
  /** CSS px -> unit-stereogram coordinates. */
  toP(x: number, y: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const h = Math.min(r.width, r.height) / 2;
    return [((x - r.width / 2) / h) * this.edge(), (-(y - r.height / 2) / h) * this.edge()];
  }
  fromP(P: [number, number]): [number, number] {
    const r = this.over.getBoundingClientRect();
    const h = Math.min(r.width, r.height) / 2;
    return [r.width / 2 + (P[0] / this.edge()) * h, r.height / 2 - (P[1] / this.edge()) * h];
  }
  drag(p1: [number, number], p2: [number, number]) {
    if (p1[0] ** 2 + p1[1] ** 2 > 1 || p2[0] ** 2 + p2[1] ** 2 > 1) return;
    this.store.applyLabRotation(rotationAtoB(stereoInverse(p1), stereoInverse(p2)));
  }
  /** Crystal direction under the pointer. */
  crystalDirAt(P: [number, number]): Vec3 {
    return matVec(transpose(this.store.R()), stereoInverse(P));
  }

  private upload() {
    const s = this.store;
    const zs = s.zoneSet();
    if (zs === this.zsUploaded) return;
    this.zsUploaded = zs;
    const R = s.refl();
    let total = 0;
    for (const z of zs.zones) total += z.refl.length;
    const data = new Float32Array(4 * Math.max(1, total));
    const zd = new Float32Array(8 * Math.max(1, zs.zones.length));
    let o = 0;
    zs.zones.forEach((z, j) => {
      zd.set([z.dir[0], z.dir[1], z.dir[2], o, z.refl.length, 0, 0, 0], 8 * j);
      for (const i of z.refl) data.set([R.g[3 * i], R.g[3 * i + 1], R.g[3 * i + 2], R.gabs[i]], 4 * o++);
    });
    this.tex.upload(data, Math.max(1, total));
    this.zoneTex.upload(zd, Math.max(1, 2 * zs.zones.length));
    this.nZones = zs.zones.length;
    this.nRefl = total;
  }

  dRange(): [number, number] {
    return this.store.dRange();
  }

  render() {
    const t0 = performance.now();
    this.dirty = false;
    const s = this.store, p = s.p, gl = this.gl;
    this.upload();
    const [W, H] = fitCanvas(this.canvas, this.lowRes ? 260 : 640, this.lowRes ? 0.5 : 1);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    const u = this.u;
    const R = s.R();
    gl.uniformMatrix3fv(u('uRt'), false, colMajor(transpose(R)));
    gl.uniformMatrix3fv(u('uMount'), false, colMajor(s.holder.mount));
    gl.uniform1f(u('uEdge'), this.edge());
    const tp = s.transfer(p.imgMode);
    this.source = p.imgMode;
    gl.uniform1f(u('uSPass'), passWidth(tp));
    const [db, dw] = this.dRange();
    gl.uniform1f(u('uDbest'), db);
    gl.uniform1f(u('uDworst'), dw);
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform2f(u('uLim'), p.enforceLimits ? p.alphaLim * DEG : 0, p.betaLim * DEG);
    gl.uniform1i(u('uNZ'), this.nZones);
    gl.uniform1f(u('uCosCut'), Math.cos(zoneCutAngle(tp, dw)));
    gl.uniform1f(u('uPx'), W / Math.max(1, this.canvas.getBoundingClientRect().width));
    this.zoneTex.bind(1, u('uZones'));
    gl.uniform1i(u('uCmap'), COLORMAP_IDS[p.mapCmap] ?? 2);
    this.tex.bind(0, u('uRefl'));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.drawOverlay();
    this.lastMs = performance.now() - t0;
  }

  private drawOverlay() {
    const s = this.store, p = s.p;
    const ctx = overlay2D(this.over);
    const r = this.over.getBoundingClientRect();
    const R = s.R();
    const L = s.crystal.lattice;
    const training = document.body.classList.contains('training');
    const accent = cssVar('--accent') || '#4cc9f0';
    const edge = this.edge();
    const inView = (P: [number, number]) => Math.abs(P[0]) <= edge * 1.02 && Math.abs(P[1]) <= edge * 1.02 * (r.height / r.width > 1 ? r.height / r.width : 1);

    // plane traces (Kikuchi band centres): great circles perpendicular to strong g
    if (p.mapTraces && !training) {
      const Rf = s.refl();
      const seen = new Set<string>();
      const planes: Vec3[] = [];
      for (let i = 0; i < Rf.n && planes.length < 9; i++) {
        if (!Rf.allowed[i]) continue;
        const h = [Rf.hkl[3 * i], Rf.hkl[3 * i + 1], Rf.hkl[3 * i + 2]];
        if (seen.has(h.map((x) => -x).join(','))) continue;
        seen.add(h.join(','));
        planes.push([Rf.g[3 * i], Rf.g[3 * i + 1], Rf.g[3 * i + 2]]);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      for (const g of planes) {
        const gl3 = normalize(matVec(R, g));
        const e1 = normalize(Math.abs(gl3[2]) < 0.9 ? cross(gl3, [0, 0, 1]) : cross(gl3, [1, 0, 0]));
        const e2 = cross(gl3, e1);
        ctx.beginPath();
        let pen = false;
        for (let k = 0; k <= 360; k++) {
          const ph = k * DEG;
          const d: Vec3 = [0, 1, 2].map((j) => Math.cos(ph) * e1[j] + Math.sin(ph) * e2[j]);
          if (d[2] < 0.02) {
            pen = false;
            continue;
          }
          const [x, y] = this.fromP(stereoForward(d));
          if (pen) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          pen = true;
        }
        ctx.stroke();
      }
    }

    // tilt rings: total tilt from the current beam direction (radius tan(theta/2) on the map)
    this.rings = [];
    if (!training && p.mapRings) {
      const h = Math.min(r.width, r.height) / 2;
      const cornerP = (edge * Math.hypot(r.width, r.height)) / 2 / h;
      const maxDeg = (2 * Math.atan(cornerP)) / DEG;
      const cx = r.width / 2, cy = r.height / 2;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      for (const a of ringAngles(p.mapRange, maxDeg)) {
        const rad = (Math.tan((a * DEG) / 2) / edge) * h;
        this.rings.push(a);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, 2 * Math.PI);
        ctx.stroke();
        // label where the ring crosses the upper-right diagonal, or the right edge
        let lx = cx + rad * Math.cos(Math.PI / 4), ly = cy - rad * Math.sin(Math.PI / 4);
        if (lx > r.width - 28 || ly < 12) {
          const dy = Math.sqrt(Math.max(0, rad * rad - (r.width / 2 - 30) ** 2));
          lx = r.width - 30;
          ly = cy - dy;
          if (!(dy > 0) || ly < 12) continue;
        }
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText(`${a}°`, lx + 2, ly - 2);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    // zone axes
    this.hits = [];
    const cands: { x: number; y: number; w: number; h: number; ix: number[]; uvw: number[]; imp: number }[] = [];
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const zones = s.zones().filter((z) => Math.max(...z.uvw.map(Math.abs)) <= p.mapZoneIdx);
    const lenMin = zones.length ? zones[0].len : 1;
    // resolution reached *on* each zone (independent of orientation, cached per parameter set)
    const tp = s.transfer(p.imgMode);
    const zs = s.zoneSet();
    const [db, dwst] = this.dRange();
    const okey = `${p.crystal}|${p.dw}|${p.kV}|${p.lateralRes}|${p.imgMode}|${p.sliceThickness}|${p.sliceDepth}|${p.depthRes}|${p.thickness}|${p.mapZoneIdx}`;
    if (okey !== this.onZoneKey) {
      this.onZone.clear();
      this.onZoneKey = okey;
    }
    const zoneD = (z: Zone) => {
      const k = z.uvw.join(',');
      let d = this.onZone.get(k);
      if (d === undefined) {
        d = resolution2D(s.refl(), z.dir, tp, zs, TAU, dwst).d;
        this.onZone.set(k, d);
      }
      return d;
    };
    for (const z of zones) {
      const d = matVec(R, z.dir);
      if (d[2] < 0.01) continue;
      const P = stereoForward(d);
      if (!inView(P)) continue;
      const [x, y] = this.fromP(P);
      const imp = lenMin / z.len; // 1 for the shortest zone
      const rad = 2 + 3.5 * imp;
      const dz = zoneD(z);
      ctx.fillStyle = Number.isFinite(dz) ? cmapCSS(p.mapCmap, (dwst - dz) / (dwst - db)) : 'rgba(150,150,150,0.9)';
      let outOfRange = false;
      if (p.enforceLimits) {
        const t = tiltToBring(s.holder.mount, z.dir);
        outOfRange = Math.abs(t.alpha) > p.alphaLim * DEG || Math.abs(t.beta) > p.betaLim * DEG;
      }
      ctx.strokeStyle = outOfRange ? '#ff5a52' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = outOfRange ? 2 : 1;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      this.hits.push({ x, y, zone: z });
      if (!training) {
        const ix = dirIdx(L, z.uvw);
        cands.push({ x: x + rad + 2, y: y - rad - 10, w: idxWidth(ctx, ix, '[', ']'), h: 12, ix, uvw: z.uvw, imp });
      }
    }
    // labels for every zone within the index limit, lowest index first, skipping collisions
    this.labelled = [];
    const ok = placeLabels(cands, r.width, r.height);
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    cands.forEach((c, i) => {
      if (!ok[i]) return;
      ctx.fillStyle = c.imp > 0.3 ? '#fff' : 'rgba(255,255,255,0.78)';
      drawIdx(ctx, c.ix, c.x, c.y + 10, { open: '[', close: ']' });
      this.labelled.push(c.uvw);
    });
    ctx.shadowBlur = 0;
    // holder range outline: crystal directions on the beam at the edge of the alpha/beta range
    this.outlinePts = 0;
    if (p.enforceLimits && !training) {
      const pts = holderOutline(s.holder.mount, p.alphaLim * DEG, p.betaLim * DEG, 64);
      ctx.save();
      ctx.strokeStyle = '#ff5a52';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 2;
      ctx.beginPath();
      let pen = false;
      for (const c of [...pts, pts[0]]) {
        const d = matVec(R, c);
        if (d[2] < 0.02) {
          pen = false;
          continue;
        }
        const [x, y] = this.fromP(stereoForward(d));
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
        this.outlinePts++;
      }
      ctx.stroke();
      ctx.restore();
    }
    // beam crosshair
    const cx = r.width / 2, cy = r.height / 2;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    // colour bar
    if (!training) {
      const dw = dwst;
      const bw = Math.min(160, r.width * 0.45), bx = r.width - bw - 10, by = r.height - 22;
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      for (let i = 0; i <= 10; i++) grad.addColorStop(i / 10, cmapCSS(p.mapCmap, i / 10));
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 3;
      ctx.textAlign = 'left';
      ctx.fillText(`${fmt(dw, 1)} Å`, bx, by - 3);
      ctx.textAlign = 'right';
      ctx.fillText(`${fmt(db, 2)} Å`, bx + bw, by - 3);
      ctx.textAlign = 'left';
      ctx.fillText(`±${+p.mapRange.toFixed(p.mapRange < 10 ? 2 : 1)}°${p.mapSyncDP ? ' (= DP)' : ''}  ${p.imgMode === 'sum' ? 'depth sum' : 'MEP slice'}`, 8, r.height - 10);
      if (p.enforceLimits) {
        const t = `holder range α ±${p.alphaLim}° β ±${p.betaLim}°`;
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(4, r.height - 36, ctx.measureText(t).width + 8, 15);
        ctx.fillStyle = '#ff7b74';
        ctx.fillText(t, 8, r.height - 25);
      }
      ctx.shadowBlur = 0;
    }
  }
}
