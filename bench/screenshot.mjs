// README / link-preview screenshot: serves dist/, sets a fixed scene and writes a PNG.
// usage: npm run build && node bench/screenshot.mjs [--out public/screenshot.png] [--scene name]
// 1600x838 is the 1.91:1 shape link previews (Open Graph) expect; the same file is the README image.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const out = resolve(opt('--out', 'public/screenshot.png'));
const scene = opt('--scene', 'slice');
const SCENES = {
  // Si 0.4 deg off [110]: nearest-zone arrow in the DP, map around the beam, MEP slice image
  slice: "s.set('imgMode', 'slice'); s.setTilt(0.4 * D, -0.25 * D);",
  sum: "s.set('imgMode', 'sum'); s.setTilt(0.12 * D, -0.08 * D);",
  onzone: "s.set('imgMode', 'slice'); s.setTilt(0, 0);",
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (p.endsWith('/')) p += 'index.html';
  try {
    const d = await readFile(join('dist', p));
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    res.end(d);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 838 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.zoner && window.zoner.img.lastMs > 0, null, { timeout: 30000 });
await page.evaluate((js) => {
  const z = window.zoner, s = z.store, D = Math.PI / 180;
  s.loadCrystal('Si');
  s.mountZone([1, 1, 0]);
  new Function('s', 'D', js)(s, D);
  z.markAll();
}, SCENES[scene]);
await page.mouse.move(1, 1);
await page.waitForTimeout(1500); // Bloch and the image settle after the last change
await page.screenshot({ path: out });
console.log(`wrote ${out} (${scene})`);
await browser.close();
server.close();
