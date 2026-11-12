# zoner development plan

Living plan for continuing work across sessions.

- **Read §1 first** in a new session.
- Keep §3 (next actions) prioritized.
- Append to §10 (session log) whenever a chunk of work is committed.

Related: [README.md](README.md) (use, physics summary, deploy).

---

## 1. Start here (state at the end of session 3, 2026-11-12: `feat/session-3` on top of 0.0.2, not merged)

| item | state |
|------|-------|
| version | `0.0.2` on `main` (tag `v0.0.2`); session 3 work on `feat/session-3` (unmerged, CHANGELOG "Unreleased"). No remote yet. History: [CHANGELOG.md](CHANGELOG.md) |
| stack | Vite 7 + TypeScript 5.9 + three.js 0.187, raw WebGL2 shaders; static site, no backend |
| installed | npm packages only, local to `node_modules/` (see `package.json`): three, vite, vitest 3, typescript 5, vite-plugin-singlefile, playwright-core (drives the system `/usr/bin/google-chrome`; no browser download), @types/three. No conda env was created. Node 20.20 (nvm) was already present |
| tests | `npm test`: 73 vitest tests (29 physics, 9 depth weight, 35 UI helpers/state) |
| e2e | `node bench/e2e.mjs --gpu` and `--swiftshader`: no console errors, 32/32 checks, timings + screenshots in `~/scratch/zoner-bench/` (local disk; the repo is on an sshfs mount) |
| builds | `npm run build:pages` produces `dist/` (site) and `dist/zoner.html` (~650 kB single file, runs from `file://`) |
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
      `gh repo create zoner --public --source . --remote origin && git push -u origin main --tags`.
      Then Settings → Pages → Source: GitHub Actions. Pages on a private repo needs a paid plan.
- [ ] Pick a license (package.json says `UNLICENSED` for now). three.js is MIT. The Lobato
      coefficients are published numbers (cited).
- [ ] At the microscope: does the DP orientation and handedness match your camera? The app shows the
      pattern seen from the gun, with no camera rotation. A per-microscope rotation/flip setting is §3 P1.
- [ ] Do the arrow-key senses feel natural (the pattern moves the way of the arrow)? Is the default
      step 0.2° right?
- [ ] Do the defaults (300 kV, α = 3 mrad, 20 nm, Δz = 2 nm, depth 3 nm, lateral 0.5 Å) match
      your MEP conditions?
- [ ] Holder switch semantics: switching on keeps the orientation and relabels it with the stage
      reading typed in (prefilled with the current α/β). Is that the workflow you meant?

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
  diffraction.ts    s_g, two-beam, kinematic, beamMode (auto parallel/CBED)
  bloch.ts          N-beam Bloch (real-symmetric embedding), beam selection
  eigen.ts          tred2/tql2
  orientation.ts    Holder (R = Rx(α) Ry(β) Mount), tiltToBring, mountForZone, rotationAtoB
  zones.ts          enumerate/nearest zones, 4-index, HTML/canvas index formatting helpers
  transfer.ts       depth/lateral transfer, ZoneSet, passWidth, resolution2D (worst-direction metric)
  stereo.ts         beam-centred stereographic projection
src/render/         WebGL2 panels (each has dirty flag + render() + lastMs)
  gl.ts             program/texture/float-target helpers, GLSL + JS colormaps
  dpView.ts         instanced spots/disks → float FBO; composite with Kikuchi bands + tone map;
                    spots vs CBED disks from beamMode (single α, zoom-aware)
  imageView.ts      Fourier synthesis → float FBO (panel aspect) → readback min/max → colormap;
                    one view, mode = Params.imgMode (sum | slice)
  stereoView.ts     per-pixel zone-based resolution metric + 2D overlay (markers, traces, tilt rings,
                    colour bar)
  crystalView.ts    three.js slab/cluster, orthographic camera, HTML labels, species legend
  label.ts          canvas index labels with overbars
src/ui/             layout.ts (canvasSize, tilt-ring spacing; pure, tested),
                    state.ts (Store, Params, derived caches), controls.ts (schema → sidebar),
                    input.ts (pointer), training.ts, hash.ts (URL state), util.ts
src/main.ts         2×2 layout + rail, event wiring, map hover readout, info panel, persistence,
                    render loop (adaptive throttling)
bench/e2e.mjs       headless Chrome: smoke, 23 checks, timings, screenshots (-> ~/scratch/zoner-bench)
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

- **Session 2 layout**: 2×2 grid sized to the window (CSS grid with two `minmax(0, 1fr)` rows,
  panels `min-height: 0`, stages flex instead of a fixed aspect ratio). Every view already scaled by
  min(width, height), so non-square stages only needed two fixes: the image synthesis grid now
  follows the panel aspect (imgFov spans the shorter side), and `fitCanvas` scales both sides
  together when capped. The orientation info went to a right rail rather than the settings
  sidebar because its α/β "go" table is read constantly at the microscope; ⓘ hides it.
- **Single convergence angle, automatic illumination**: `beamMode` draws disks once their radius
  exceeds 2σ of the spot blur (in device px), else spots. So the decision depends on zoom, which
  matches what the eye sees: a 0.5 mrad disk is a spot at 2.2 Å⁻¹ half-width but a disk at
  0.1 Å⁻¹. Training forces α = 0. The √/log auto display switches on real overlap (2r > g_min);
  the old 0.9·g_min flattened the default 3 mrad Si [110] pattern, whose disks nearly touch.
- **Holder range switch** (session 2b, user request): off by default so the simulated tilt can go
  anywhere while matching an observed pattern. Switching on calls `Store.engageHolder(α, β)`:
  M' = (Rx(α)Ry(β))ᵀ·R keeps the crystal orientation and makes the readout equal the stage reading;
  only an explicitly typed reading outside the range is refused. With nothing typed (third round:
  "activate whenever"), the reading is `defaultStageReading()`: the current α/β if inside the range
  (switching on then only enables the limits), else 0, 0, so a pattern matched far outside the range
  can still be engaged. Re-engaging while on re-anchors. Shortcut L. Assumes the simulated holder axes match the
  real ones (camera rotation/flip is §3 P1).
- **Map follows the image** (session 2b, user request): one `imgMode` for both. With the default
  depth sum through 20 nm the map's bright regions are small (tilt tolerance ≈ lateral/t ≈ 0.15°);
  that is correct and is the reason MEP slices help.
- **Holder range on the map** (fourth round): the old hatch (×0.25/×0.55) vanished over the grey
  "not atomic" background. Now the out-of-range region is desaturated and dimmed with red stripes
  every 10 CSS px (uPx scales device px), and the overlay draws the reachable-region outline from
  `holderOutline()` (beam directions along the α/β rectangle edge, tested by round trip through
  `tiltToBring`). Out-of-range zone markers get a red ring.
- **Zone labels** (fourth round): `placeLabels()` greedy, lowest index first, real text widths
  (`idxWidth`), no index-based cut. Si [110] at ±30°: 27 labels at index ≤ 3, 88 at ≤ 5.
- **Resolution colour scale capped at 1.5 Å** (user request: coarser is not atomic resolution).
  `dRange()` = [lateral, max(1.5, 1.25·lateral)]; the same value is the metric's dWorst, so the
  map, the zone markers and the orientation readout ("> 1.5 Å") agree, and zoneCutAngle prunes
  more zones (slightly faster map).
- **Tilt rings** (off by default since session 2b; hover gives the same number) measure the total tilt angle from the current beam (circles of radius tan(θ/2) on
  the beam-centred map), not |Δα|/|Δβ|, which are not concentric. The hover readout gives the
  holder α/β for any point, and the "go" table gives them for zones.
- **Finite-specimen slice weight** (session 3, user request: thin specimens stay sharp when
  tilted). The slice weight is w(ζ) = box_t(ζ)·(box_Δz ⊛ G)(ζ − z0): the reconstruction is
  (V·box_t) ⊛ G, integrated over the slice window. The old closed form Δz·sinc·exp(−2π²σ²g²)
  ignored box_t. w is held as uniform piecewise-linear runs (5 nodes per σ inside ±4σ of each
  blurred edge, one segment where it is flat) and transformed exactly per segment, so there is no
  aliasing at any g_z; the interpolant damps by sinc²(g h) (≤ 0.25% of the area, tested against the
  old formula deep inside a 400 nm crystal). One depth transfer feeds the image, passWidth (map,
  readout) and the zone cache (its key now includes the slice depth). Normalisation: the slice
  amplitude is ∫w, so a slice whose blur reaches beyond the specimen holds only its share of the
  potential (total over all slices conserved); a 200 nm PSF on a 0.5 nm specimen gives the depth
  sum's shape at ~1% of its amplitude (auto contrast hides the scale). Measured: t = 0.5 nm,
  Δz = 2 nm, depth 3 nm: smear-equivalent length 0.26 nm (was 1.67 nm), = the depth sum's.
- **λ/α² checkbox** (session 3): Store-level (`depthAuto`, `syncAutoDepth`), so links and the
  sidebar agree; a typed depthRes unchecks it. α → 0 caps at 1000 nm instead of ∞. Training sets
  α = 0 directly on `p`, so it does not disturb the depth setting.
- **Off-zone residual fringes in the depth sum: investigated, not changed** (session 3; the user
  dropped it: in MEP the dominant blur is within the slice, and mis-tilt mainly hurts ADF-STEM via
  dechanneling). Findings for the record (Si [110], 20 nm, rms phase over 20 Å):
  tilt 0/2/3/5/8° → 1.63/0.47/0.09/0.20/0.12 rad. The residuals are low-index reflections (111,
  220) in the sinc sidelobes of the sharp-walled slab (T g_z = −1.5 at 5°), i.e. partial planes
  cut by the surfaces; they are 5–12% of the on-zone phase, and auto contrast stretches them.
  Envelopes at realistic values barely help (5°: 2 nm surface roughness → 0.16 rad, 0.25° mosaic
  spread → 0.13 rad and −18% on zone). Random amorphous layers (1 nm/side ≈ 0.1 rad rms, matched
  Campbell's theorem) did break up the 3° and 8° fringes in a GPU prototype, but cost ~15× image
  time on SwiftShader; reverted. The prototype is archived in
  `~/scratch/zoner-bench/session3/amorphous-attempt/` (not in git). Frozen-phonon displacement was
  judged minor (DW B is already in F_g).
- **Links carry `v=2`.** Links without it are from 0.0.1; their `convAlpha` was the imaging
  aperture, so it is dropped and `dpIllum/dpAlpha` become the new α (unit-tested).

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
- The repo sits on an sshfs mount (`/home/cl2696/altas`). Keep benchmark output and throwaway
  worktrees on local NVMe (`~/scratch`); `node_modules` can be symlinked into a worktree.
- `FloatTarget.resize` resets texture filtering to NEAREST; set LINEAR again after resizing when the
  target is sampled for display (image view).
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

### Session 2: before/after, same machine, 1600×1000 window

Both measured in this session with each version's own `bench/e2e.mjs` (v0.0.1 built from a
worktree of the tag). Median ms per re-render after a tilt. Session 2 panels are larger (2×2
instead of 3 columns), and only one image panel renders per frame (v0.0.1 rendered both).

| scene | renderer | DP | map | depth sum | MEP slice | 3D |
|---|---|---|---|---|---|---|
| Si [110] two-beam, v0.0.1 (SAED) | RTX 5000 | 2.3 | 2.1 | 3.2 | 3.0 | 6.1 |
| Si [110] two-beam, session 2, α = 0 | RTX 5000 | 2.5 | 2.8 | 2.7 | 3.1 | 5.9 |
| Si [110] two-beam, session 2, default α = 3 mrad (CBED) | RTX 5000 | 2.6 | 2.6 | 3.2 | 3.8 | 6.6 |
| Si CBED 20 mrad, v0.0.1 / session 2 | RTX 5000 | 2.5 / 2.4 | 2.1 / 2.7 | 2.4 / 2.7 | 3.1 / 3.3 | 5.0 / 7.0 |
| Si [110] two-beam, v0.0.1 (SAED) | SwiftShader | 31.8 | 90.1 | 20.9 | 9.0 | 218 |
| Si [110] two-beam, session 2, α = 0 | SwiftShader | 38.1 | 107 | 22.0 | 6.4 | 128 |
| Si [110] two-beam, session 2, default 3 mrad | SwiftShader | 29.6 | 105 | 23.2 | 10.7 | 223 |
| Si CBED 20 mrad, v0.0.1 / session 2 | SwiftShader | 126 / 118 | 94 / 107 | 19 / 23 | 5.5 / 5.4 | 129 / 123 |

GPU: no change beyond noise. SwiftShader: the map is ~15% slower (bigger panel, same 640 px cap) and
the DP slightly slower at α = 0. Per tilt frame, the total drops because one image panel replaces
two. The 3D numbers on SwiftShader swing 120–220 ms between runs (first-render geometry
rebuilds), so they are not comparable row to row.

### Session 3: finite-specimen slice weight, same machine, 1600×1000 window

Median ms per re-render after a tilt; `main` (v0.0.2) rebuilt in a scratch worktree and run with
its own e2e in the same session. CPU coefficient time (node, Si, 24k reflections): depth sum
1.26 → 0.98 ms, slice 1.19 → 1.16 ms, lateral 0.3 Å slice 2.00 → 1.99 ms (the bound skips more).

| scene | renderer | DP | map | depth sum | MEP slice | 3D |
|---|---|---|---|---|---|---|
| Si [110] default, v0.0.2 / session 3 | RTX 5000 | 2.4 / 2.4 | 2.9 / 2.4 | 2.7 / 3.0 | 3.4 / 2.8 | 6.6 / 6.1 |
| Si lateral 0.3 Å, v0.0.2 / session 3 | RTX 5000 | 3.8 / 4.3 | 2.8 / 2.4 | 3.4 / 3.5 | 4.1 / 3.6 | 5.8 / 5.2 |
| Si thin 0.5 nm slice (new row) | RTX 5000 | 2.5 | 3.0 | 3.1 | 3.2 | 5.0 |
| Si [110] default, v0.0.2 / session 3 | SwiftShader | 25.5 / 40.9 | 104 / 97 | 21.8 / 24.5 | 9.6 / 10.1 | 124 / 224 |
| Si lateral 0.3 Å, v0.0.2 / session 3 | SwiftShader | 36.5 / 40.0 | 102 / 105 | 30.9 / 32.3 | 8.3 / 7.4 | 117 / 124 |
| Si thin 0.5 nm slice (new row) | SwiftShader | 40 | 304 | 75 | 72 | 40 |

No change beyond noise (SwiftShader DP and 3D swing run to run, as in session 2). The thin row is
slower on SwiftShader because a 0.5 nm specimen passes many more reflections (wide depth
transfer); the depth sum, whose formula did not change, costs the same, so it is the specimen,
not the new weight.

## 9. Compatibility matrix

Session 2: "parallel" means α = 0 or disks smaller than the spot size; "convergent" means
disks drawn (α > 0 and big enough at the current zoom).

| feature \ setting | parallel (α = 0) | convergent (auto CBED) | hexagonal | CIF upload | big cell (Ω ≳ 2000 Å³) | phone |
|---|---|---|---|---|---|---|
| kinematic / two-beam DP | works | works (per-pixel rocking) | works (4-index labels) | works | works; reflections capped at 40k (g_max lowered) | works |
| Bloch DP | works (idle-time) | partial: disks uniformly filled (no rocking) | works (complex U via embedding) | works | slow above ~150 beams | works |
| Kikuchi bands | works | works | works | works | works (64 strongest planes) | works |
| resolution map (follows image mode) + rings + hover | n/a | n/a | works (index ≤ setting in 3-index) | works | slower (more ZOLZ reflections) | works (rings; no hover on touch) |
| real-space image (sum / slice toggle) | n/a | n/a | works | works | coefficients capped at 4096 | works |
| 3D legend | n/a | n/a | works | works (any element; unknown colour falls back to pink) | works | works |
| 2×2 fit-to-window layout | n/a | n/a | n/a | n/a | n/a | n/a: phones (< 900 px) stack and scroll by design |
| holder range switch | works | works | works | works | works | works |
| training | works (forced α = 0) | n/a | works | works | works | works (touch drag; no keys) |
| CIF without symops | n/a | n/a | n/a | treated as P1, with a toast warning | n/a | n/a |
| finite-specimen slice weight | works | works | works | works | works | works |
| λ/α² auto depth | α = 0 → 1000 nm cap (slice ≈ depth sum) | works | works | works | works | works |
| offline single file | works | works | works | works | works | works |
| 0.0.1 links / saved state | migrated (v=2 marker) | migrated (dpAlpha → α) | n/a | n/a | n/a | n/a |

Layout verified without scrolling at 1920×1080, 1600×1000, 1366×768 and 1280×720 (e2e). Untested:
windows shorter than ~650 px on desktop (panels get small but still fit), Safari/iOS WebGL2 (should work, since WebGL2 + EXT_color_buffer_float are standard);
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
- **2026-11-11, session 2.** Requested: changelog + 0.0.1, merge, then UI changes.
  - CHANGELOG.md added; version set to 0.0.1; `feat/v1-app` merged into `main` (`--no-ff`), tagged
    `v0.0.1`. Session 2 on `feat/session-2`.
  - Test-first `tests/ui.test.ts` (15 tests): `beamMode`, ring spacing, `canvasSize`, `species`,
    0.0.1-link migration.
  - One convergence angle (default 3 mrad) with automatic parallel/CBED; 2×2 fit-to-window layout
    with the orientation rail; one real-space image panel (depth sum default, toggle to MEP slice);
    tilt rings + hover α/β readout on the stereogram; 3D species legend; clearer holder ranges.
  - Bugs found on the way: `fitCanvas` stretched capped non-square canvases; the CBED display
    picked log for nearly-touching disks; the 3D legend showed over the training veil; panels
    collapsed onto each other on phones. All fixed with e2e checks.
  - Benchmarks: v0.0.1 vs session 2 on the same machine (§8). 23/23 e2e checks on GPU and
    SwiftShader, 0 console errors.
  - Second round (user feedback): rings toggle (off), λ/2α and λ/α² buttons removed (defaults 0.5 Å /
    3 nm), stereogram follows the image toggle, holder range switch with engage-at-stage-reading.
    Fixed arrow keys being swallowed by a focused checkbox. 50 unit tests, 26/26 e2e on GPU and
    SwiftShader; timings unchanged.
  - Third round: resolution colour scale capped at 1.5 Å (readout agrees); holder switch engages at
    any time (default reading current α/β inside the range, else 0, 0; re-anchors; L shortcut).
    54 unit tests, 28/28 e2e on GPU and SwiftShader.
  - Fourth round: clearer holder range on the map (outline, red stripes, red-ringed markers);
    zone labels follow the index limit. 57 unit tests, 30/30 e2e on GPU and SwiftShader.
  - Marked 0.0.2, merged `feat/session-2` into `main` (`--no-ff`), tagged `v0.0.2`.
- **2026-11-12, session 3** (`feat/session-3`). Requested: finite-specimen MEP slice, off-zone
  periodicity in the depth sum, λ/α² checkbox.
  - Image coefficients moved to `physics/image.ts`; new `tests/depth.test.ts` (9, test-first).
  - Slice weight cut to the specimen (§5): thin specimens keep their tilt tolerance in slice mode;
    deep slices unchanged; CPU cost equal or lower.
  - λ/α² checkbox (7 tests, test-first; the session-2b "no estimate buttons" test narrowed to
    λ/2α).
  - Off-zone periodicity: numerical study (§5), amorphous-layer GPU prototype built and then
    reverted at the user's request; nothing of it is in git.
  - 73 unit tests; e2e 32/32 on GPU and SwiftShader, 0 console errors; timings vs v0.0.2 (§8).
