// End-to-end smoke test + benchmark in headless Chrome (system install, via playwright-core).
// usage: node bench/e2e.mjs [--gpu|--swiftshader] [--url http://...] [--out DIR]
// Serves dist/ itself unless --url is given. Writes screenshots and timings.json to --out
// (default ~/scratch/zoner-bench: local disk, the repo may sit on a network mount).
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const mode = args.includes('--swiftshader') ? 'swiftshader' : 'gpu';
const out = resolve(opt('--out', join(homedir(), 'scratch', 'zoner-bench')));
const root = resolve(opt('--root', 'dist'));
await mkdir(out, { recursive: true });

let url = opt('--url', '');
let server;
if (!url) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const data = await readFile(join(root, p));
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
}

const flags = mode === 'gpu'
  ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', ...flags] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url + (opt('--hash', '') || ''));
try {
  await page.waitForFunction(() => window.zoner && window.zoner.dp.lastMs > 0, null, { timeout: 30000 });
} catch (e) {
  console.error('page did not render; console errors:\n' + errors.join('\n').slice(0, 4000));
  await browser.close();
  server?.close();
  process.exit(2);
}
await page.waitForTimeout(800);

const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});

// Timed re-render of each panel, synchronous (gl.finish via readPixels of 1 px) so times are real.
const bench = async (label, setup) => {
  return page.evaluate(async ({ label, setup }) => {
    const z = window.zoner;
    if (setup) new Function('z', setup)(z);
    const names = ['dp', 'map', 'imgSum', 'imgSlice', 'r3d'];
    const res = { label };
    const mode0 = z.store.p.imgMode;
    for (const n of names) {
      const v = n.startsWith('img') ? z.img : z[n];
      if (n === 'imgSum') z.store.p.imgMode = 'sum';
      if (n === 'imgSlice') z.store.p.imgMode = 'slice';
      const gl = v.canvas.getContext('webgl2');
      const px = new Uint8Array(4);
      v.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ts = [];
      for (let i = 0; i < 8; i++) {
        z.store.tiltBy(0.0005, 0);
        const t0 = performance.now();
        v.render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b);
      res[n] = +ts[Math.floor(ts.length / 2)].toFixed(2);
    }
    z.store.p.imgMode = mode0;
    res.cbed = z.dp.cbed;
    return res;
  }, { label, setup });
};

const timings = [];
timings.push(await bench('Si [110] default (CBED 3 mrad, two-beam)'));
timings.push(await bench('Si [110] parallel (alpha 0)', "z.store.p.convAlpha=0;"));
timings.push(await bench('Si CBED 2 mrad', "z.store.p.convAlpha=2;"));
timings.push(await bench('Si CBED 20 mrad', "z.store.p.convAlpha=20;"));
timings.push(await bench('Si kinematic parallel', "z.store.p.convAlpha=0; z.store.p.dpTheory='kinematic';"));
timings.push(await bench('Si lateral 0.3 A', "z.store.p.dpTheory='twobeam'; z.store.p.lateralRes=0.3;"));
timings.push(await bench('SrTiO3 [001]', "z.store.p.lateralRes=0.5; z.store.loadCrystal('SrTiO3');"));
timings.push(await bench('GaN [2-1-10]', "z.store.loadCrystal('GaN');"));
// Bloch timings at several N
const bloch = await page.evaluate(async () => {
  const z = window.zoner;
  z.store.loadCrystal('Si');
  const out = [];
  for (const N of [21, 41, 61, 101, 151]) {
    z.store.p.dpTheory = 'bloch';
    z.store.p.blochBeams = N;
    const t0 = performance.now();
    z.dp['computeBloch']();
    out.push({ N, ms: +(performance.now() - t0).toFixed(1) });
  }
  z.store.p.dpTheory = 'twobeam';
  return out;
});

// screenshots of the default view and a few states
await page.evaluate(() => {
  const z = window.zoner;
  z.store.loadCrystal('Si');
  z.store.p.lateralRes = 0.5;
  z.store.p.dpTheory = 'twobeam';
  z.store.p.convAlpha = 3;
  z.store.tiltBy(0.012, -0.02);
  z.markAll();
});
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, `default-${mode}.png`) });
const shots = [
  ['cbed', "z.store.p.convAlpha=3; z.store.p.dpRange=1.2; z.store.setTilt(0.004, 0.002);"],
  ['cbed-zoom', "z.store.p.convAlpha=8; z.store.p.dpRange=0.35; z.store.p.thickness=60; z.store.setTilt(0.0015, -0.001);"],
  ['map-sum', "z.store.p.thickness=20; z.store.p.convAlpha=0; z.store.p.dpRange=2.2; z.store.p.mapSource='sum'; z.store.p.mapRange=10; z.store.setTilt(0.01, 0.006);"],
  ['sto', "z.store.p.mapSource='slice'; z.store.p.mapRange=30; z.store.p.convAlpha=3; z.store.p.dpRange=2.2; z.store.loadCrystal('SrTiO3'); z.store.setTilt(0.03, 0.05);"],
  ['training', "z.store.loadCrystal('Si'); z.trainer.begin('easy');"],
];
for (const [name, js] of shots) {
  await page.evaluate((js) => {
    new Function('z', js)(window.zoner);
    window.zoner.markAll();
  }, js);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${name}-${mode}.png`) });
}
// ---- interaction checks: direction conventions end to end ------------------------------------
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
const box = async (sel) => page.locator(sel).boundingBox();
await page.evaluate(() => {
  const z = window.zoner;
  z.trainer.stop();
  z.store.loadCrystal('Si');
  z.store.p.dpRange = 2.2;
  z.store.p.mapRange = 20;
  z.store.mountZone([1, 1, 0]);
  z.store.setTilt(0.01, 0.01);
  z.markAll();
});
await page.waitForTimeout(300);
const kc = () => page.evaluate(() => window.zoner.kc([1, 1, 0]));
let q0 = await kc();
await page.locator('body').click({ position: { x: 5, y: 995 } });
await page.keyboard.press('ArrowRight');
let q1 = await kc();
const K = await page.evaluate(() => window.zoner.store.K);
const step = await page.evaluate(() => window.zoner.store.p.step * Math.PI / 180);
check('ArrowRight moves the Kikuchi centre right by ~K*step', q1[0] - q0[0] > 0.8 * K * step && q1[0] - q0[0] < 1.2 * K * step && Math.abs(q1[1] - q0[1]) < 0.2 * K * step, { dqx: q1[0] - q0[0], expect: K * step, dqy: q1[1] - q0[1] });
q0 = q1;
await page.keyboard.press('ArrowUp');
q1 = await kc();
check('ArrowUp moves the Kikuchi centre up', q1[1] - q0[1] > 0.8 * K * step, { dqy: q1[1] - q0[1] });
// DP drag: pattern follows the pointer
const dpb = await box('#dp-ov');
q0 = await kc();
const sc = await page.evaluate(() => window.zoner.dp.scale());
await page.mouse.move(dpb.x + dpb.width / 2, dpb.y + dpb.height / 2);
await page.mouse.down();
for (let i = 1; i <= 6; i++) await page.mouse.move(dpb.x + dpb.width / 2 + i * 10, dpb.y + dpb.height / 2 - i * 5);
await page.mouse.up();
q1 = await kc();
check('DP drag: Kikuchi centre follows the pointer', Math.abs((q1[0] - q0[0]) * sc - 60) < 8 && Math.abs((q1[1] - q0[1]) * sc - 30) < 8, { dxPx: (q1[0] - q0[0]) * sc, dyPx: (q1[1] - q0[1]) * sc, expect: [60, 30] });
// map drag: zone marker follows the pointer
const mb = await box('#map-ov');
let p0 = await page.evaluate(() => window.zoner.mapPos([1, 1, 0]));
await page.mouse.move(mb.x + p0[0], mb.y + p0[1]);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(mb.x + p0[0] + i * 8, mb.y + p0[1] + i * 4);
await page.mouse.up();
let p1 = await page.evaluate(() => window.zoner.mapPos([1, 1, 0]));
check('Map drag: zone marker follows the pointer', Math.abs(p1[0] - p0[0] - 40) < 6 && Math.abs(p1[1] - p0[1] - 20) < 6, { dx: p1[0] - p0[0], dy: p1[1] - p0[1], expect: [40, 20] });
// 3D trackball: drag right -> the zone axis (columns' top) tips right
const rb = await box('#r3d-ov');
const d0 = await page.evaluate(() => window.zoner.zoneLab([1, 1, 0]));
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(rb.x + rb.width / 2 + i * 8, rb.y + rb.height / 2);
await page.mouse.up();
const d1 = await page.evaluate(() => window.zoner.zoneLab([1, 1, 0]));
check('3D drag right tips the zone axis toward +x', d1[0] - d0[0] > 0.05, { ddx: d1[0] - d0[0] });
// "go" button reaches the zone
await page.evaluate(() => { window.zoner.store.setTilt(0.01, 0.01); window.zoner.markAll(); });
await page.waitForTimeout(200);
await page.locator('#info .go').first().click();
await page.waitForTimeout(700);
const ang = await page.evaluate(() => window.zoner.angleTo([1, 1, 0]));
check('"go" tilts onto the nearest zone', ang < 0.01, { angleDeg: ang });
// map click on a zone marker tilts there
await page.evaluate(() => { window.zoner.store.set('mapRange', 45); window.zoner.store.set('enforceLimits', false); window.zoner.store.setTilt(0, 0); window.zoner.markAll(); });
await page.waitForTimeout(300);
p0 = await page.evaluate(() => window.zoner.mapPos([1, 1, 1]));
await page.waitForTimeout(200);
const inMap = p0[0] > 5 && p0[1] > 5 && p0[0] < mb.width - 5 && p0[1] < mb.height - 5;
if (inMap) {
  await page.mouse.click(mb.x + p0[0], mb.y + p0[1]);
  await page.waitForTimeout(700);
}
const ang111 = await page.evaluate(() => window.zoner.angleTo([1, 1, 1]));
check('clicking a zone marker on the map tilts there', inMap && ang111 < 0.01, { inMap, ang: ang111 });
// with limits on, [111] from [110] needs alpha 35.26 deg > 35: clamped, and the user is told
await page.evaluate(() => { window.zoner.store.set('enforceLimits', true); window.zoner.store.setTilt(0, 0); window.zoner.markAll(); });
await page.waitForTimeout(300);
if (inMap) await page.mouse.click(mb.x + p0[0], mb.y + p0[1]);
await page.waitForTimeout(700);
const toastTxt = await page.locator('#toast').textContent();
const angLim = await page.evaluate(() => window.zoner.angleTo([1, 1, 1]));
check('beyond holder limits: clamped and reported', angLim > 0.2 && /beyond the holder range/.test(toastTxt), { angLim, toastTxt });
// Bloch wave inside the app: exact [110], symmetry-equivalent beams equal, sum = 1
await page.evaluate(() => {
  const z = window.zoner;
  z.store.loadCrystal('Si');
  z.store.mountZone([1, 1, 0]);
  z.store.set('dpTheory', 'bloch');
  z.store.set('blochBeams', 61);
});
await page.waitForTimeout(900);
const bl = await page.evaluate(() => {
  const z = window.zoner;
  const R = z.store.refl();
  const I = (h) => z.dp.bloch.I.get(R.indexOf(h)) ?? -1;
  let sum = z.dp.bloch.I0;
  for (const v of z.dp.bloch.I.values()) sum += v;
  return { status: z.dp.blochStatus(), i1: I([1, -1, 1]), i2: I([-1, 1, -1]), i3: I([1, -1, -1]), i4: I([-1, 1, 1]), i002: I([0, 0, 2]), sum, ms: z.dp.bloch.ms };
});
check('Bloch on [110]: 1-11 family equal, 002 excited by double diffraction, sum 1', /Bloch \d+ beams/.test(bl.status) && Math.abs(bl.i1 - bl.i2) < 1e-6 && Math.abs(bl.i1 - bl.i3) < 1e-6 && Math.abs(bl.i1 - bl.i4) < 1e-6 && bl.i002 > 1e-4 && Math.abs(bl.sum - 1) < 1e-6, bl);
await page.screenshot({ path: join(out, `bloch-${mode}.png`) });
await page.evaluate(() => window.zoner.store.set('dpTheory', 'twobeam'));

// training: Z (go to nearest) solves the round
await page.evaluate(() => window.zoner.trainer.begin('easy'));
await page.waitForTimeout(300);
await page.keyboard.press('z');
await page.waitForTimeout(800);
const solved = await page.evaluate(() => window.zoner.trainer.solved);
check('training round is detected as solved on zone', solved, solved);
await page.keyboard.press('t');
await page.waitForTimeout(200);
// CIF upload
await page.setInputFiles('#cif-file', { name: 'GaN-test.cif', mimeType: 'text/plain', buffer: Buffer.from(`data_GaN
_chemical_formula_sum 'Ga N'
_cell_length_a 3.189
_cell_length_b 3.189
_cell_length_c 5.185
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 120
loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'-y, x-y, z'
'-x+y, -x, z'
'-x, -y, z+1/2'
'y, -x+y, z+1/2'
'x-y, x, z+1/2'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Ga1 Ga 0.33333 0.66667 0.0
N1 N 0.33333 0.66667 0.377
`) });
await page.waitForTimeout(800);
const cifState = await page.evaluate(() => ({ name: window.zoner.store.p.crystal, n: window.zoner.store.crystal.sites.length, hex: window.zoner.store.crystal.lattice.isHexagonal }));
check('CIF upload loads the structure', cifState.n === 4 && cifState.hex, cifState);
// link round trip
await page.evaluate(() => { window.zoner.store.loadCrystal('SrTiO3'); window.zoner.store.setTilt(0.0123, -0.0456); window.zoner.store.set('thickness', 33); });
await page.waitForTimeout(600);
const hash = await page.evaluate(() => location.hash);
const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const p2 = await ctx2.newPage();
await p2.goto(url + hash);
await p2.waitForFunction(() => window.zoner && window.zoner.dp.lastMs > 0, null, { timeout: 30000 });
const restored = await p2.evaluate(() => ({ c: window.zoner.store.p.crystal, a: window.zoner.store.holder.alpha, b: window.zoner.store.holder.beta, t: window.zoner.store.p.thickness }));
check('shared link restores crystal, tilt and parameters', restored.c === 'SrTiO3' && Math.abs(restored.a - 0.0123) < 1e-4 && Math.abs(restored.b + 0.0456) < 1e-4 && restored.t === 33, restored);
await ctx2.close();

// ---- session 2: layout, image toggle, legend, auto illumination, tilt rings, hover ----------
await page.evaluate(() => {
  const z = window.zoner;
  z.trainer.stop();
  localStorage.clear();
});
const fresh = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const pf = await fresh.newPage();
pf.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
pf.on('pageerror', (e) => errors.push(String(e)));
await pf.goto(url);
await pf.waitForFunction(() => window.zoner && window.zoner.dp.lastMs > 0 && window.zoner.img.lastMs > 0, null, { timeout: 30000 });
await pf.waitForTimeout(500);
const defaults = await pf.evaluate(() => ({ imgMode: window.zoner.store.p.imgMode, convAlpha: window.zoner.store.p.convAlpha, cbed: window.zoner.dp.cbed, rings: window.zoner.map.rings }));
check('defaults: depth-sum image, convergent 3 mrad drawn as CBED disks', defaults.imgMode === 'sum' && defaults.convAlpha === 3 && defaults.cbed, defaults);
check('stereogram draws tilt rings at 10 and 20 deg (half-range 20)', defaults.rings.includes(10) && defaults.rings.includes(20), defaults.rings);
const layoutAt = async (w, h) => {
  await pf.setViewportSize({ width: w, height: h });
  await pf.waitForTimeout(400);
  return pf.evaluate(() => {
    const b = (id) => document.getElementById(id).getBoundingClientRect();
    const g = document.getElementById('grid');
    const se = document.scrollingElement;
    const st = (id) => b(id).height;
    const r = { dp: b('panel-dp'), r3d: b('panel-r3d'), map: b('panel-map'), img: b('panel-img') };
    return {
      pageScroll: se.scrollHeight - window.innerHeight,
      gridScroll: g.scrollHeight - g.clientHeight,
      bottom: Math.max(r.dp.bottom, r.r3d.bottom, r.map.bottom, r.img.bottom) - window.innerHeight,
      grid2x2: Math.abs(r.dp.left - r.map.left) < 2 && Math.abs(r.r3d.left - r.img.left) < 2 && r.dp.right < r.r3d.left && r.dp.bottom < r.map.top && Math.abs(r.dp.top - r.r3d.top) < 2,
      stageH: Math.min(st('dp-gl'), st('map-gl'), st('r3d-gl'), st('img-gl')),
    };
  });
};
for (const [w, h] of [[1920, 1080], [1600, 1000], [1366, 768], [1280, 720]]) {
  const L = await layoutAt(w, h);
  check(`${w}x${h}: 2x2 panels fit the window without scrolling`, L.pageScroll <= 0 && L.gridScroll <= 1 && L.bottom <= 0 && L.grid2x2 && L.stageH > 150, L);
}
await pf.setViewportSize({ width: 1600, height: 1000 });
await pf.waitForTimeout(300);
await pf.screenshot({ path: join(out, `layout-${mode}.png`) });
// image toggle
await pf.locator('#panel-img button', { hasText: 'MEP slice' }).click();
await pf.waitForTimeout(300);
const tog = await pf.evaluate(() => ({ m: window.zoner.store.p.imgMode, z: getComputedStyle(document.getElementById('img-z').parentElement).display, ms: window.zoner.img.msBy.slice }));
await pf.screenshot({ path: join(out, `layout-slice-${mode}.png`) });
await pf.locator('#panel-img button', { hasText: 'Depth sum' }).click();
await pf.waitForTimeout(200);
const tog2 = await pf.evaluate(() => window.zoner.store.p.imgMode);
check('image panel toggles depth sum <-> MEP slice (z slider only for the slice)', tog.m === 'slice' && tog.z !== 'none' && tog.ms > 0 && tog2 === 'sum', { tog, tog2 });
// legend
await pf.evaluate(() => window.zoner.store.loadCrystal('SrTiO3'));
await pf.waitForTimeout(400);
const leg = await pf.locator('#r3d-legend').innerText();
check('3D legend lists every species (SrTiO3: Sr, Ti, O)', /Sr/.test(leg) && /Ti/.test(leg) && /\bO\b/.test(leg), leg);
// automatic illumination
const ill = await pf.evaluate(async () => {
  const z = window.zoner;
  z.store.loadCrystal('Si');
  const at = (a, r) => { z.store.p.convAlpha = a; z.store.p.dpRange = r; z.dp.render(); return z.dp.cbed; };
  const out = { a0: at(0, 2.2), a05: at(0.5, 2.2), a05zoom: at(0.5, 0.1), a3: at(3, 2.2) };
  z.store.p.dpRange = 2.2;
  return out;
});
check('illumination is automatic: alpha 0 / small disks -> spots, larger or zoomed -> CBED', !ill.a0 && !ill.a05 && ill.a05zoom && ill.a3, ill);
// hover readout on the map
const mb2 = await pf.locator('#map-ov').boundingBox();
await pf.mouse.move(mb2.x + mb2.width / 2 + 60, mb2.y + mb2.height / 2 - 30);
await pf.waitForTimeout(100);
const hov = await pf.locator('#map-lbl').innerText();
check('stereogram hover shows the tilt from the beam and the alpha/beta needed', /from beam/.test(hov) && /α/.test(hov) && /β/.test(hov), hov);
await fresh.close();

// mobile layout
await page.evaluate(() => window.zoner.trainer.stop());
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, `mobile-${mode}.png`), fullPage: false });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const mob = await page.evaluate(() => {
  const ids = ['panel-dp', 'panel-r3d', 'panel-map', 'panel-img', 'panel-info'];
  const r = ids.map((id) => document.getElementById(id).getBoundingClientRect());
  let ok = true;
  for (let i = 1; i < r.length; i++) if (r[i].top < r[i - 1].bottom - 1) ok = false;
  return { stacked: ok, stageH: document.getElementById('dp-gl').getBoundingClientRect().height };
});
check('phone: panels stack in one column without overlapping', mob.stacked && mob.stageH > 250 && !overflow, mob);
await page.evaluate(() => window.scrollTo(0, 700));
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, `mobile2-${mode}.png`), fullPage: false });

const result = { mode, renderer, url, errors, checks, timings, bloch, mobileHorizontalOverflow: overflow };
await writeFile(join(out, `timings-${mode}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
server?.close();
if (errors.length || checks.some((c) => !c.ok)) process.exitCode = 1;
