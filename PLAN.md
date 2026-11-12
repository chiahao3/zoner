# zoner development plan

Living plan for continuing work across sessions.

- **Read §1 first** in a new session.
- Keep §3 (next actions) prioritized.
- Append to §10 (session log) whenever a chunk of work is committed.

Related: [README.md](README.md) (use, physics summary, deploy).

---

## 1. Start here (state at the end of session 1, 2026-11-11)

| item | state |
|------|-------|
| version | `0.1.0`, branch `feat/v1-app` (not merged; `main` holds only the scaffold commit). No remote yet |
| stack | Vite 7 + TypeScript 5.9 + three.js 0.187, raw WebGL2 shaders; static site, no backend |
| installed | npm packages only, local to `node_modules/` (see `package.json`): three, vite, vitest 3, typescript 5, vite-plugin-singlefile, playwright-core (drives the system `/usr/bin/google-chrome`; no browser download), @types/three. No conda env was created. Node 20.20 (nvm) was already present |
| tests | `npm test`: 29 vitest tests (physics core) pass in ~0.1 s |
| e2e | `node bench/e2e.mjs --gpu` and `--swiftshader`: no console errors, 12/12 interaction checks, timings + screenshots in `bench/out/` (gitignored) |
| builds | `npm run build:pages` produces `dist/` (site) and `dist/zoner.html` (640 kB single file, verified offline from `file://`) |
| deploy | `.github/workflows/pages.yml` (test, build, deploy on push to `main`). Needs a GitHub repo + Pages source "GitHub Actions" (§2) |

Commands:

```bash
npm ci && npm test
npm run dev                         # http://localhost:5173
npm run build:pages
node bench/e2e.mjs --gpu            # ~1 min; GPU via ANGLE/Vulkan on the RTX 5000
node bench/e2e.mjs --swiftshader    # software GL, slow-device worst case
```

## 2. Human checklist (for the user)

- [ ] Create the GitHub repo and push (not done by Claude: pushing publishes). For example:
      `gh repo create zoner --public --source . --remote origin && git push -u origin main feat/v1-app`,
      then merge `feat/v1-app` into `main` when happy. Then Settings → Pages → Source: GitHub Actions.
      Pages on a private repo needs a paid plan.
- [ ] Pick a license (package.json says `UNLICENSED` for now). three.js is MIT. The Lobato
      coefficients are published numbers (cited).
- [ ] At the microscope: does the DP orientation and handedness match your camera? The app shows the
      pattern seen from the gun, with no camera rotation. A per-microscope rotation/flip setting is §3 P1.
- [ ] Do the arrow-key senses feel natural (the pattern moves the way of the arrow)? Is the default
      step 0.2° right?
- [ ] Do the defaults (300 kV, 20 mrad, 20 nm, Δz = 2 nm, depth 4.9 nm = λ/α², lateral 0.5 Å)
      match your MEP conditions?

## 3. Next actions (prioritized; each has "done when")

- **P1 DP parser hook (the user's stated long-term goal).** Load a DP image. Find the transmitted beam
  and the Kikuchi bands/Laue circle (or spot symmetry), estimate the zone centre q_zc, which gives the
  tilt vector, and show which way to tilt and by how much. The building blocks exist: `DPView.dirAtQ`
  maps a q to a lab direction, and `Store.applyLabRotation`/`goToDirection` apply tilts. Done when a
  simulated DP fed back through the parser recovers the tilt within 0.2°.
- **P1 Camera rotation / flip setting** so the DP matches the microscope screen. Done when a rotation
  angle and a mirror checkbox transform the DP, the overlay and the drag sense consistently, with an
  e2e check.
- **P1 Holder calibration**: set the mount from two indexed observations (zone A at α1/β1, zone B at
  α2/β2) so the α/β table predicts real stage readings. Done when a synthetic calibration round-trips.
- **P2 Bloch CBED**: coarse grid of incident directions (e.g. 7×7 per disk, interpolated) on idle.
  Bloch + convergent currently fills each disk uniformly with the central-direction intensity.
- **P2 Absorption** (imaginary U'_g ≈ 0.1 U_g) for Bloch and two-beam, so thick-crystal contrast is
  less extreme.
- **P2 Touch**: pinch zoom on the DP/map, larger touch targets for the "go" buttons.
- **P2 MEP slice finite-thickness edges**: slices near the surfaces should see only crystal inside
  [0, t]. The current synthesis assumes an infinite slab around the slice.
- **P3 Missing-cone depth transfer** option (from α) instead of a Gaussian depth PSF.
- **P3 Space-group tables** so CIFs with only a H-M symbol expand (now treated as P1, with a warning).

## 4. Architecture (as built)

```
src/physics/        pure TS, unit-tested
  constants.ts      λ, γ, σ (relativistic)
  elements.ts       Lobato f_e(g), symbols, display colours/radii; data/lobato.json (Z = 1..103)
  linalg.ts         Vec3/Mat3 (row-major), rotations
  lattice.ts        Lattice: A (direct, columns), B = A^-T (reciprocal, no 2π); a ∥ x, b in xy
  crystal.ts        Site/Crystal, built-ins, addUnique (periodic dedupe)
  cif.ts            tokenizer, loops, symops "x-y,z+1/2", atom sites, Uiso→B
  structure.ts      F_g, U_g, ξ_g, buildReflections (sorted by |g|, capped at 40k)
  diffraction.ts    s_g, two-beam, kinematic
  bloch.ts          N-beam Bloch (real-symmetric embedding), beam selection
  eigen.ts          tred2/tql2
  orientation.ts    Holder (R = Rx(α) Ry(β) Mount), tiltToBring, mountForZone, rotationAtoB
  zones.ts          enumerate/nearest zones, 4-index, HTML/canvas index formatting helpers
  transfer.ts       depth/lateral transfer, ZoneSet, passWidth, resolution2D (worst-direction metric)
  stereo.ts         beam-centred stereographic projection
src/render/         WebGL2 panels (each has dirty flag + render() + lastMs)
  gl.ts             program/texture/float-target helpers, GLSL + JS colormaps
  dpView.ts         instanced spots/disks → float FBO; composite with Kikuchi bands + tone map
  imageView.ts      Fourier synthesis → float FBO → readback min/max → colormap
  stereoView.ts     per-pixel zone-based resolution metric + 2D overlay (markers, traces, legend)
  crystalView.ts    three.js slab/cluster, orthographic camera, HTML labels
  label.ts          canvas index labels with overbars
src/ui/             state.ts (Store, Params, derived caches), controls.ts (schema → sidebar),
                    input.ts (pointer), training.ts, hash.ts (URL state), util.ts
src/main.ts         layout, event wiring, info panel, persistence, render loop (adaptive throttling)
bench/e2e.mjs       headless Chrome: smoke, interaction checks, timings, screenshots
```

## 5. Design decisions (and why)

- **Static client-side app, everything on the GPU.** Microscope sessions need instant response and
  zero install. GitHub Pages hosts it, and a single-file build covers offline PCs. Measured per-panel
  render times are in §8.
- **Lab frame**: x right, y up as seen from the gun, z toward the gun, beam along −z. Zone axes point
  up the column (the Williams & Carter convention). The Kikuchi centre of zone d sits at q = −K d_xy,
  and the stereogram plots −d so zone markers sit on the same side as in the DP.
- **Holder model R = Rx(α)·Ry(β)·Mount** (the β axis is carried by α, as on a double-tilt holder).
  Every drag is converted into a lab rotation, then into the nearest α/β via `tiltToBring`, so all
  panels stay holder-consistent and the α/β readouts are meaningful.
- **Grab semantics per panel**: in the DP and the map the features follow the pointer; in the 3D view
  and the images, a trackball (the object follows the pointer). Arrow keys follow the DP sense.
  Verified by e2e (to within 0.05 px).
- **DP theory**: the default is independent two-beam per reflection ("moderate dynamical"), which
  gives correct positions, extinction-distance scaling and thickness fringes in real time. The 000
  beam/disk uses I₀ = exp(−ΣI_g), which keeps the central disk visible on zone, where independent
  two-beam sums exceed 1, and still draws HOLZ deficit lines. Full Bloch (N ≤ 201) runs when you
  pause: 61 beams take ~12 ms.
- **Images by Fourier synthesis** (not atom splatting). Exact for a perfect slab, cost independent of
  thickness, and the same transfer function as the map, so the panels can't disagree.
- **Resolution metric** (decided after two numerical failures, recorded in §10):
  1. Global reflections with a 50% threshold: random high-index reflections inside the thin
     |g·n| shell gave a false 0.93 Å at a general orientation. Fixed by evaluating per low-index zone
     (index ≤ map setting), using only ZOLZ reflections. Regression test added.
  2. "Two non-collinear (>15°)" pairs produced spiky, anisotropic artifacts. Replaced by the
     worst-direction support, d = 1/min_e max_g |g·e|.
  3. The 50% depth threshold disagreed with the lateral FWHM cut (off-zone d was 1.9× the column
     smear). Now one threshold, exp(−π²/4ln2) ≈ 0.028 (a Gaussian's transfer at g = 1/FWHM), applies
     to the first lobe of the depth transfer. On zone d = lateral FWHM, off zone d ≈ t·tanθ. Test:
     ratio within 0.75–1.3.
- **Display**: dark UI (microscope rooms are dark). DP log scale for SAED. CBED uses √ when disks are
  separated, and log when they overlap (Ronchigram-like), which would otherwise saturate.
- **Adaptive throttling**: while you drag, any panel slower than 30 ms is re-rendered at most every
  ~3 render times, so the DP stays responsive on software GL.

## 6. Principles

- Physics changes are test-first in `tests/physics.test.ts`. UI conventions are checked in
  `bench/e2e.mjs` (it exits non-zero on any console error or failed check).
- Units: Å, Å⁻¹, rad internally. The UI shows nm for thicknesses and mrad for angles in the
  diffraction plane.
- The app is qualitative: positions, symmetry and the trends of tilt and thickness are right.
  Intensities are approximate (no absorption, perfect crystal, no TDS).

## 7. Know-how and gotchas

- npm 10 with vite 8 / vitest 5 failed peer resolution ("Cannot read properties of null (reading
  'edgesOut')"), so the project pins vite 7 + vitest 3.
- Don't run `vitest --root /`: it crawls the whole filesystem. Put probes in `tests/_probe.test.ts`
  and delete them afterwards.
- GLSL: name clashes inside `main()` (`a` was used twice) only show up at runtime. The e2e prints the
  page errors when the first render times out.
- Headless GPU: `--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist` gives the real
  NVIDIA renderer. Without these flags you get SwiftShader.
- STO 100 is weak for electrons (f_Sr − f_Ti − f_O ≈ 0.09 Å), so the "allowed" flag
  (|F| > 2% of the in-phase sum) marks it as not significant. This is real physics, not a bug.

## 8. Validation and benchmarks (session 1)

Extinction distances, 100 kV, B = 0, compared with Williams & Carter Table 13.1:

| reflection | zoner (nm) | W&C (nm) |
|---|---|---|
| Si 111 | 61.7 | 60.2 |
| Si 220 | 76.2 | 75.7 |
| Al 111 | 55.6 | 55.6 |
| Al 200 | 66.8 | 67.3 |
| Al 220 | 105.7 | 105.7 |

Bloch on exact Si [110] (300 kV, 20 nm, 61 beams): the four {111} beams are equal to 1e-15, the total
intensity is 1.000000, and the forbidden 002 gets 1.2% by double diffraction.

Median render time per panel (ms), 1600×1000 window, each re-render after a tilt:

| scene | renderer | DP | map | depth sum | MEP slice | 3D |
|---|---|---|---|---|---|---|
| Si [110] SAED two-beam | RTX 5000 (ANGLE/Vulkan) | 2.4 | 2.1 | 2.7 | 2.9 | 6.1 |
| Si CBED 20 mrad | RTX 5000 | 2.6 | 2.1 | 2.3 | 3.2 | 5.1 |
| Si lateral 0.3 Å | RTX 5000 | 3.6 | 2.3 | 3.6 | 4.1 | 4.9 |
| Si [110] SAED two-beam | SwiftShader (CPU) | 35.9 | 89.5 | 20.6 | 10.6 | 218 |
| Si CBED 20 mrad | SwiftShader | 117 | 88.1 | 21.9 | 6.2 | 217 |

Bloch (CPU, JS): N = 41: 7 ms; 61: 12 ms; 101: 24–30 ms; 151: 80–150 ms. The first call includes
~70 ms of JIT warm-up.

## 9. Compatibility matrix

| feature \ setting | parallel (SAED) | convergent (CBED) | hexagonal | CIF upload | big cell (Ω ≳ 2000 Å³) | phone |
|---|---|---|---|---|---|---|
| kinematic / two-beam DP | works | works (per-pixel rocking) | works (4-index labels) | works | works; reflections capped at 40k (g_max lowered) | works |
| Bloch DP | works (idle-time) | partial: disks uniformly filled (no rocking) | works (complex U via embedding) | works | slow above ~150 beams | works |
| Kikuchi bands | works | works | works | works | works (64 strongest planes) | works |
| resolution map | n/a | n/a | works (index ≤ setting in 3-index) | works | slower (more ZOLZ reflections) | works |
| images | n/a | n/a | works | works | coefficients capped at 4096 | works |
| training | works (forced) | n/a | works | works | works | works (touch drag; no keys) |
| CIF without symops | n/a | n/a | n/a | treated as P1, with a toast warning | n/a | n/a |
| offline single file | works | works | works | works | works | works |

Untested: Safari/iOS WebGL2 (should work, since WebGL2 + EXT_color_buffer_float are standard);
real microscope camera orientations (§2).

## 10. Session log

- **2026-11-11, session 1.** Repo created (`main` = scaffold; work on `feat/v1-app`).
  - Physics core written test-first (26, then 29 tests). Extinction distances validated (§8).
  - Web app: DP (SAED/CBED, kinematic/two-beam/Bloch, Kikuchi), resolution stereogram, 3D slab,
    depth-sum and MEP-slice images, info panel, training mode, CIF upload, URL/localStorage state,
    help dialog, light/dark theme.
  - Resolution metric went through three numerically tested revisions (§5), each with a failing test
    first: per-zone ZOLZ evaluation (no false resolution at general orientations), worst-direction
    support, and an FWHM-consistent threshold (off-zone d matches t·tanθ).
  - e2e harness with 12 interaction checks (direction senses, go/click-to-zone, clamping, Bloch
    symmetry, training, CIF upload, link round trip). Single-file offline build verified from
    `file://`. GitHub Pages workflow added.
  - Open: §2 checklist (repo creation/push, license, camera orientation), §3 P1 items.
