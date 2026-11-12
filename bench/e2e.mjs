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
timings.push(await bench('Si thin 0.5 nm, slice', "z.store.loadCrystal('Si'); z.store.p.thickness=0.5; z.store.p.sliceDepth=0.25;"));
timings.push(await bench('Si auto depth (alpha 25 mrad -> 3.15 nm)', "z.store.p.thickness=20; z.store.p.sliceDepth=10; z.store.set('convAlpha', 25); z.store.set('depthAuto', true);"));
timings.push(await bench('Si lambda/beta (90 mrad -> 0.219 A)', "z.store.set('depthAuto', false); z.store.p.depthRes=3; z.store.p.convAlpha=3; z.store.set('lateralAuto', true);"));
timings.push(await bench('Si detector range on, map synced to DP', "z.store.set('lateralRes', 0.5); z.store.set('dpDetector', true); z.store.set('dpRange', 6); z.store.set('mapSyncDP', true);"));
await page.evaluate(() => { const s = window.zoner.store; s.set('mapSyncDP', false); s.set('mapRange', 20); s.set('dpDetector', false); s.set('dpRange', 2.2); s.set('lateralAuto', false); s.p.lateralRes = 0.5; s.set('depthAuto', false); s.p.depthRes = 3; s.p.convAlpha = 3; s.p.thickness = 20; s.p.sliceDepth = 10; });
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
  ['map-sum', "z.store.p.thickness=20; z.store.p.convAlpha=0; z.store.p.dpRange=2.2; z.store.p.imgMode='sum'; z.store.p.mapRange=10; z.store.setTilt(0.01, 0.006);"],
  ['sto', "z.store.p.imgMode='sum'; z.store.p.mapRings=true; z.store.p.mapRange=30; z.store.p.convAlpha=3; z.store.p.dpRange=2.2; z.store.loadCrystal('SrTiO3'); z.store.setTilt(0.03, 0.05);"],
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
const defaults = await pf.evaluate(() => {
  const z = window.zoner, p = z.store.p;
  return { imgMode: p.imgMode, convAlpha: p.convAlpha, cbed: z.dp.cbed, rings: z.map.rings.slice(), lateral: p.lateralRes, depth: p.depthRes, limits: p.enforceLimits,
    estimateButtons: /λ\/2α/.test(document.getElementById('side').innerText) || document.querySelectorAll('#side button').length > 0,
    depthAuto: document.getElementById('ctl-depthAuto')?.checked };
});
check('defaults: depth sum, 3 mrad CBED, 0.5 A / 3 nm (λ/α² unchecked), no rings, holder range off, no λ/2α buttons',
  defaults.imgMode === 'sum' && defaults.convAlpha === 3 && defaults.cbed && defaults.rings.length === 0 && defaults.lateral === 0.5 && defaults.depth === 3 && !defaults.limits && !defaults.estimateButtons && defaults.depthAuto === false, defaults);
await pf.locator('#panel-map button', { hasText: 'Rings' }).click();
await pf.waitForTimeout(300);
const rings = await pf.evaluate(() => window.zoner.map.rings.slice());
check('Rings toggle draws tilt rings at 10 and 20 deg (half-range 20)', rings.includes(10) && rings.includes(20), rings);
await pf.locator('#panel-map button', { hasText: 'Rings' }).click();
await pf.waitForTimeout(200);
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
const tog = await pf.evaluate(() => ({ m: window.zoner.store.p.imgMode, z: getComputedStyle(document.getElementById('img-z').parentElement).display, ms: window.zoner.img.msBy.slice,
  mapSrc: window.zoner.map.source, mapLbl: document.getElementById('map-src').textContent, sel: document.getElementById('ctl-imgMode').value }));
check('stereogram colouring follows the image toggle', tog.mapSrc === 'slice' && tog.mapLbl === 'MEP slice' && tog.sel === 'slice', tog);
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
// holder range switch: match the pattern with free tilts, then engage at the stage reading
const hs = await pf.evaluate(() => {
  const z = window.zoner;
  z.store.loadCrystal('Si');
  z.store.setTilt(50 * Math.PI / 180, -40 * Math.PI / 180); // outside the range: allowed while off
  return { a: z.store.holder.alpha * 180 / Math.PI, R: z.store.R() };
});
await pf.waitForTimeout(200);
await pf.fill('#stage-a', '10');
await pf.fill('#stage-b', '-5');
await pf.locator('#holder-box .switch').click();
await pf.waitForTimeout(300);
const hs2 = await pf.evaluate((R0) => {
  const z = window.zoner, R = z.store.R();
  return { a: z.store.holder.alpha * 180 / Math.PI, b: z.store.holder.beta * 180 / Math.PI, on: z.store.p.enforceLimits,
    dR: Math.max(...R.map((x, i) => Math.abs(x - R0[i]))), readHidden: getComputedStyle(document.getElementById('holder-read')).display === 'none' };
}, hs.R);
for (let i = 0; i < 30; i++) await pf.keyboard.press('Shift+ArrowUp'); // 1 deg each: 10 -> 40, clamped at 35
const hs3 = await pf.evaluate(() => window.zoner.store.holder.alpha * 180 / Math.PI);
check('holder switch: free tilt while off; on = same orientation read as the stage α/β, then clamped',
  Math.abs(hs.a - 50) < 1e-6 && hs2.on && Math.abs(hs2.a - 10) < 1e-6 && Math.abs(hs2.b + 5) < 1e-6 && hs2.dR < 1e-9 && hs2.readHidden && Math.abs(hs3 - 35) < 1e-6, { hs: hs.a, hs2, alphaAfterKeys: hs3 });
await pf.locator('#holder-box .switch').click();
await pf.waitForTimeout(200);
check('holder switch off releases the limits', await pf.evaluate(() => !window.zoner.store.p.enforceLimits), null);
// activate at any time: matched far outside the range, press L without typing a reading
const lk = await pf.evaluate(() => {
  const z = window.zoner;
  z.store.setTilt(50 * Math.PI / 180, -40 * Math.PI / 180);
  return z.store.R();
});
await pf.waitForTimeout(200);
await pf.locator('.brand').click();
await pf.keyboard.press('l');
await pf.waitForTimeout(300);
const lk2 = await pf.evaluate((R0) => {
  const z = window.zoner, R = z.store.R();
  return { on: z.store.p.enforceLimits, a: z.store.holder.alpha, b: z.store.holder.beta, dR: Math.max(...R.map((x, i) => Math.abs(x - R0[i]))), toast: document.getElementById('toast').textContent };
}, lk);
check('L engages the holder range at any time (outside the range: taken as stage 0, 0; orientation kept)', lk2.on && Math.abs(lk2.a) < 1e-12 && Math.abs(lk2.b) < 1e-12 && lk2.dR < 1e-9, lk2);
await pf.keyboard.press('l');
await pf.waitForTimeout(200);
const cs = await pf.evaluate(() => ({ off: !window.zoner.store.p.enforceLimits, range: window.zoner.store.dRange() }));
check('L toggles off again; resolution colour scale is 0.5-1.5 A', cs.off && cs.range[0] === 0.5 && cs.range[1] === 1.5, cs);

// zone labels follow the index limit
const lab = async (n) => {
  await pf.evaluate((n) => { const z = window.zoner; z.store.p.enforceLimits = false; z.store.loadCrystal('Si'); z.store.set('mapRange', 30); z.store.set('mapZoneIdx', n); z.markAll(); }, n);
  await pf.waitForTimeout(400);
  return pf.evaluate(() => window.zoner.map.labelled.map((u) => Math.max(...u.map(Math.abs))));
};
const l3 = await lab(3), l5 = await lab(5);
await pf.screenshot({ path: join(out, `map-idx5-${mode}.png`) });
check('stereogram labels zones up to the index limit (3 -> 5 adds index-4/5 labels)',
  l3.every((m) => m <= 3) && l5.some((m) => m > 3) && l5.every((m) => m <= 5) && l5.length > l3.length, { n3: l3.length, n5: l5.length, max5: Math.max(...l5) });
// holder range: outline drawn when engaged, near the edge of the range
await pf.evaluate(() => { const z = window.zoner; z.store.set('mapZoneIdx', 3); z.store.engageHolder(28, 22); z.markAll(); });
await pf.waitForTimeout(400);
const ol = await pf.evaluate(() => window.zoner.map.outlinePts);
await pf.screenshot({ path: join(out, `holder-range-${mode}.png`) });
await pf.evaluate(() => { window.zoner.store.releaseHolder(); window.zoner.markAll(); });
await pf.waitForTimeout(300);
const ol0 = await pf.evaluate(() => window.zoner.map.outlinePts);
check('holder range outline is drawn on the map only while the range is on', ol > 10 && ol0 === 0, { ol, ol0 });

// hover readout on the map
const mb2 = await pf.locator('#map-ov').boundingBox();
await pf.mouse.move(mb2.x + mb2.width / 2 + 60, mb2.y + mb2.height / 2 - 30);
await pf.waitForTimeout(100);
const hov = await pf.locator('#map-lbl').innerText();
check('stereogram hover shows the tilt from the beam and the alpha/beta needed', /from beam/.test(hov) && /α/.test(hov) && /β/.test(hov), hov);

// ---- session 3: finite-specimen slice, auto depth resolution ---------------------------------
// lambda/alpha^2 checkbox, driven through the sidebar
await pf.evaluate(() => { const z = window.zoner; z.store.loadCrystal('Si'); z.markAll(); });
await pf.locator('#ctl-depthAuto').check();
await pf.waitForTimeout(150);
const da1 = await pf.evaluate(() => ({ v: +document.getElementById('ctl-depthRes').value, p: window.zoner.store.p.depthRes }));
await pf.locator('#ctl-convAlpha').fill('25');
await pf.locator('#ctl-convAlpha').press('Tab');
await pf.waitForTimeout(150);
const da2 = await pf.evaluate(() => ({ v: +document.getElementById('ctl-depthRes').value, on: document.getElementById('ctl-depthAuto').checked }));
await pf.locator('#ctl-depthRes').fill('4');
await pf.locator('#ctl-depthRes').press('Tab');
await pf.waitForTimeout(150);
const da3 = await pf.evaluate(() => ({ p: window.zoner.store.p.depthRes, on: document.getElementById('ctl-depthAuto').checked, auto: window.zoner.store.p.depthAuto }));
check('λ/α² checkbox fills the depth resolution (3 mrad: 218.75 nm, 25 mrad: 3.15 nm); typing a value unchecks it',
  Math.abs(da1.v - 218.75) < 0.01 && da1.p === da1.v && Math.abs(da2.v - 3.15) < 1e-9 && da2.on && da3.p === 4 && !da3.on && !da3.auto, { da1, da2, da3 });
await pf.evaluate(() => { const z = window.zoner; z.store.set('convAlpha', 3); z.store.set('depthRes', 3); });
// thin specimen: the slice cannot tilt worse than the whole (0.5 nm) specimen
const thin = await pf.evaluate(() => {
  const z = window.zoner;
  z.store.set('thickness', 0.5); z.store.set('sliceDepth', 0.25); z.store.set('imgMode', 'slice');
  z.store.mountZone([1, 1, 0]);
  z.store.setTilt(4 * Math.PI / 180, 1 * Math.PI / 180);
  z.markAll();
  return null;
});
await pf.waitForTimeout(400);
const thinTxt = await pf.evaluate(() => {
  const kv = [...document.querySelectorAll('#info .kv')].map((e) => e.innerText);
  return { slice: kv.find((t) => /MEP slice/.test(t)), sum: kv.find((t) => /depth sum/.test(t)) };
});
const num = (t) => parseFloat((t ?? '').replace(/^[^\d>]*/, '').replace('>', ''));
check('thin specimen (0.5 nm, 4° off): MEP slice resolution equals the depth sum (finite-specimen slice)',
  thinTxt.slice && thinTxt.sum && Math.abs(num(thinTxt.slice.split('\n').pop()) - num(thinTxt.sum.split('\n').pop())) < 0.02, thinTxt);
await pf.screenshot({ path: join(out, `thin-slice-${mode}.png`) });
await pf.evaluate(() => { const s = window.zoner.store; s.set('thickness', 20); s.set('sliceDepth', 10); s.set('imgMode', 'sum'); s.setTilt(0, 0); window.zoner.markAll(); });

// ---- session 4: collection angle, detector range, derived 1/A, DP hover, lambda/beta, FOV sync --
const unitTxt = () => pf.evaluate(() => {
  const t = (id) => { const u = document.querySelector(id).closest('.row').querySelector('.unit'); return { s: u.textContent.replace(/\s+/g, ' '), clipped: u.scrollWidth > u.clientWidth + 1 || u.getBoundingClientRect().right > document.getElementById('side').getBoundingClientRect().right }; };
  const a = t('#ctl-convAlpha'), b = t('#ctl-collAngle');
  return { a: a.s, b: b.s, clipped: a.clipped || b.clipped };
});
const u0 = await unitTxt();
await pf.locator('#ctl-convAlpha').fill('25');
await pf.locator('#ctl-convAlpha').press('Tab');
await pf.waitForTimeout(150);
const u1 = await unitTxt();
const a25 = await pf.evaluate(() => ({ p: window.zoner.store.p.convAlpha, v: document.getElementById('ctl-convAlpha').value }));
check('angle fields: typed in mrad, 1/A shown in brackets, not clipped (3 mrad 0.152, 90 mrad 4.57, 25 mrad 1.27)',
  u0.a === 'mrad (0.152 Å⁻¹)' && u0.b === 'mrad (4.57 Å⁻¹)' && u1.a === 'mrad (1.27 Å⁻¹)' && !u0.clipped && a25.p === 25 && a25.v === '25', { u0, u1, a25 });
await pf.locator('#side details').first().screenshot({ path: join(out, `side-angles-${mode}.png`) });
await pf.evaluate(() => window.zoner.store.set('convAlpha', 3));
// detector range toggle
await pf.locator('#panel-dp button', { hasText: 'Detector' }).click();
await pf.waitForTimeout(250);
const det1 = await pf.evaluate(() => ({ on: window.zoner.store.p.dpDetector, d: window.zoner.dp.detector, btn: document.querySelector('#panel-dp button.on')?.textContent }));
await pf.evaluate(() => { window.zoner.store.set('dpRange', 6); });
await pf.waitForTimeout(300);
const det2 = await pf.evaluate(() => window.zoner.dp.detector);
await pf.locator('#panel-dp').screenshot({ path: join(out, `dp-detector-${mode}.png`) });
await pf.locator('#panel-dp button', { hasText: 'Detector' }).click();
await pf.waitForTimeout(250);
const det3 = await pf.evaluate(() => ({ on: window.zoner.store.p.dpDetector, d: window.zoner.dp.detector }));
check('Detector button toggles the square detector (half-width = collection angle) on the DP (covers the view at 2.2 1/A, edge drawn at 6 1/A)',
  det1.on && det1.btn === 'Detector' && det1.d && !det1.d.visible && Math.abs(det1.d.rq - 4.571) < 0.01 && det2.visible && !det3.on && det3.d === null, { det1, det2, det3 });
await pf.evaluate(() => window.zoner.store.set('dpRange', 2.2));
// DP hover at the [110] Kikuchi centre: same alpha/beta as the "go" table, consistent deg / mrad / 1/A
await pf.evaluate(() => { const z = window.zoner; z.store.mountZone([1, 1, 0]); z.store.setTilt(1.2 * Math.PI / 180, -0.7 * Math.PI / 180); z.dp.pan = [0, 0]; z.markAll(); });
await pf.waitForTimeout(400);
const tgt = await pf.evaluate(() => {
  const z = window.zoner, q = z.kc([1, 1, 0]), r = document.getElementById('dp-ov').getBoundingClientRect(), sc = z.dp.scale();
  const row = document.querySelector('#info table.zones tbody tr').innerText.split(/\s+/);
  return { x: r.left + r.width / 2 + q[0] * sc, y: r.top + r.height / 2 - q[1] * sc, q, K: z.store.K, row };
});
await pf.mouse.move(tgt.x, tgt.y);
await pf.waitForTimeout(150);
const dpHov = await pf.locator('#dp-lbl').innerText();
const m = dpHov.match(/([\d.]+)° from beam \(([\d.]+) mrad, ([\d.]+) Å⁻¹\) · α (-?[\d.]+)° β (-?[\d.]+)°/);
const qAbs = Math.hypot(...tgt.q);
const okHover = m && Math.abs(+m[4] - +tgt.row[2]) < 0.03 && Math.abs(+m[5] - +tgt.row[3]) < 0.03 && Math.abs(+m[1] - parseFloat(tgt.row[1])) < 0.03
  && Math.abs(+m[2] - +m[1] * Math.PI / 180 * 1000) < 0.2 && Math.abs(+m[3] - qAbs) < 0.004;
check('DP hover at the [110] Kikuchi centre: tilt from beam (deg, mrad, 1/A) and α/β match the go table', okHover, { dpHov, row: tgt.row, qAbs });
await pf.mouse.move(5, 5);
// map field of view synced to the DP
await pf.locator('#panel-map button', { hasText: 'DP FOV' }).click();
await pf.waitForTimeout(400);
const fov = await pf.evaluate(() => {
  const z = window.zoner, p = z.store.p;
  const dpR = document.getElementById('dp-ov').getBoundingClientRect(), mR = document.getElementById('map-ov').getBoundingClientRect();
  const q = z.kc([1, 1, 0]), mp = z.mapPos([1, 1, 0]);
  const fDP = Math.hypot(...q) / p.dpRange; // fraction of the half-width (pan 0)
  const fMap = Math.hypot(mp[0] - mR.width / 2, mp[1] - mR.height / 2) / (Math.min(mR.width, mR.height) / 2);
  return { on: p.mapSyncDP, range: p.mapRange, want: Math.asin(p.dpRange / z.store.K) * 180 / Math.PI, fDP, fMap, sel: document.getElementById('ctl-mapRange').selectedOptions[0].textContent };
});
await pf.screenshot({ path: join(out, `fov-sync-${mode}.png`) });
const mb3 = await pf.locator('#map-ov').boundingBox();
await pf.mouse.move(mb3.x + mb3.width / 2, mb3.y + mb3.height / 2);
await pf.mouse.wheel(0, 300);
await pf.waitForTimeout(300);
const fov2 = await pf.evaluate(() => { const z = window.zoner, p = z.store.p; return { on: p.mapSyncDP, dp: p.dpRange, range: p.mapRange, want: Math.asin(p.dpRange / z.store.K) * 180 / Math.PI }; });
await pf.evaluate(() => { document.getElementById('ctl-mapRange').closest('details').open = true; });
await pf.selectOption('#ctl-mapRange', '20');
await pf.waitForTimeout(200);
const fov3 = await pf.evaluate(() => ({ on: window.zoner.store.p.mapSyncDP, range: window.zoner.store.p.mapRange, btn: document.querySelector('#panel-map button.on')?.textContent ?? null }));
check('DP FOV: the map half-range follows the DP (same marker fraction), map wheel zooms both, choosing a range ends it',
  fov.on && Math.abs(fov.range - fov.want) < 1e-9 && Math.abs(fov.fMap / fov.fDP - 1) < 0.02 && /\(DP\)/.test(fov.sel)
  && fov2.on && fov2.dp > 2.2 && Math.abs(fov2.range - fov2.want) < 1e-9 && !fov3.on && fov3.range === 20 && fov3.btn !== 'DP FOV', { fov, fov2, fov3 });
await pf.evaluate(() => window.zoner.store.set('dpRange', 2.2));
// lambda/beta checkbox
await pf.locator('#ctl-lateralAuto').check();
await pf.waitForTimeout(150);
const lb1 = await pf.evaluate(() => ({ v: +document.getElementById('ctl-lateralRes').value, p: window.zoner.store.p.lateralRes }));
await pf.locator('#ctl-collAngle').fill('60');
await pf.locator('#ctl-collAngle').press('Tab');
await pf.waitForTimeout(150);
const lb2 = await pf.evaluate(() => ({ p: window.zoner.store.p.lateralRes, on: document.getElementById('ctl-lateralAuto').checked }));
await pf.locator('#ctl-lateralRes').fill('0.5');
await pf.locator('#ctl-lateralRes').press('Tab');
await pf.waitForTimeout(150);
const lb3 = await pf.evaluate(() => ({ p: window.zoner.store.p.lateralRes, on: document.getElementById('ctl-lateralAuto').checked }));
check('λ/β checkbox fills the lateral resolution (90 mrad: 0.219 Å, 60 mrad: 0.328 Å); typing a value unchecks it',
  lb1.v === 0.219 && lb1.p === 0.219 && lb2.p === 0.328 && lb2.on && lb3.p === 0.5 && !lb3.on, { lb1, lb2, lb3 });
await pf.evaluate(() => window.zoner.store.set('collAngle', 90));
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
