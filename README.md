# zoner

**Live: https://chiahao3.github.io/zoner/**

![zoner: diffraction pattern, crystal model, resolution stereogram and MEP slice image of Si 0.4° off \[110\]](public/screenshot.png)

A browser tool for tilting crystals onto a zone axis at the microscope. Every panel shares one
double-tilt holder state, and you can tilt from any of them with the mouse or the arrow keys.

The workspace is a 2×2 grid that always fits the window: diffraction space on the left, real space
on the right, and the orientation panel in a rail on the right (ⓘ hides it, ☰ hides the settings).

| panel | what it shows |
|---|---|
| **Diffraction** (top left) | Reflections at their excitation error, as spots or CBED disks. One convergence angle α sets the illumination: α = 0 is a parallel beam; otherwise disks of radius α are drawn as CBED once they are larger than the spot size (default 3 mrad). Kikuchi bands. An arrow to the nearest zone axis with its angle. Hovering gives the angle from the beam (deg, mrad, Å⁻¹) and the α/β for the direction under the pointer. **Detector** draws the square detector (half-width = collection angle β, default 64 mrad) and dims beyond it. Choice of theory: kinematic, per-reflection two-beam (dynamical, real time), or a many-beam Bloch wave computed whenever you stop moving. |
| **Resolution stereogram** (bottom left) | A map centred on the beam, coloured by the projected 2D resolution you would get if you tilted to that direction, for the image currently shown (depth sum or MEP slice; one toggle drives both). It responds to the slice thickness, depth resolution and total thickness. The colour scale runs from the lateral resolution to 1.5 Å; coarser is not atomic resolution and is grey. Zone markers are coloured by the resolution reached *on* that zone. Hovering shows the total tilt from the beam and the α/β needed; **Rings** adds dashed rings of total tilt (off by default). **DP FOV** matches the map's field of view to the diffraction pattern, and zooming either keeps them matched. With the holder range on, a red outline bounds the reachable orientations and everything beyond it is dimmed with red stripes. Every zone up to the index limit is labelled where its label fits. In depth-sum mode the bright regions are small: a 20 nm projection tolerates only ~0.15° of tilt at 0.5 Å. |
| **Crystal model** (top right) | The specimen slab, with slice boundaries and the current MEP slice highlighted, or a unit-cell cluster. A legend lists each species. |
| **Real-space image** (bottom right) | Depth sum (default) or MEP slice, switched in the panel header (the stereogram follows): the phase image σ∫V dz of the tilted crystal. Tilt smears the columns by t·tanθ. The display range is global per mode (the same image on the crystal's low-index zone), so mistilt shows as lost contrast; **Auto contrast** stretches each image instead. |
| **Orientation** (rail) | The **holder range** switch (off by default): tilt freely until the simulation matches the observed pattern, enter the stage α/β reading and switch on (or press L) at any time. With nothing typed, the reading is the current α/β if inside the range, else 0, 0. The orientation is kept, the α/β readout now matches the stage, and tilts are limited to the range (symmetric: 35 means −35° … +35°). Below: α, β, the beam direction, the nearest zones with the α/β needed to reach each one and a "go" button, the current 2D resolution and the column smear. |

Built-in crystals are Si, SrTiO3, Al, Au, Cu, GaAs, MgO, Fe (bcc) and GaN (wurtzite). Any CIF that
lists its symmetry operators can be loaded, either with **CIF…** or by dropping the file on the page.

## Use

- Hosted: GitHub Pages (see "Deploy").
- Offline: `zoner.html` is a single 640 kB file that runs from disk with no network. It is linked in
  the help dialog and built by `npm run build:single`.
- Keys: ← → ↑ ↓ tilt (the pattern moves the way of the arrow; Shift ×5, Alt ×0.2). Q/E rotate in
  plane. Z goes to the nearest zone, 0 sets α = β = 0, L toggles the holder range, ? opens help.
- **Link** copies a URL that restores the crystal, the orientation and every setting.

## Physics, briefly

- Electron scattering factors: Lobato & Van Dyck, *Acta Cryst.* A70, 636 (2014). Debye-Waller B is
  0.5 Å² by default. U_g = γF_g/(πΩ). Extinction distances agree with Williams & Carter to within 2.5%
  (see `PLAN.md` §8).
- The beam travels along −z. s_g = (K² − |k₀+g|²)/2K. Two-beam: I = sin²(πts_eff)/(ξs_eff)².
  Bloch: ψ(t) = exp(iπtA/K)e₀, using a real-symmetric embedding of the Hermitian A (JAMA
  tred2/tql2). There is no absorption.
- Images use Fourier synthesis of V_g × lateral Gaussian × depth transfer. The depth transfer is the
  Fourier transform of a depth weight: a box [0, t] for the depth sum; for a slice, the slice window
  blurred by the Gaussian depth PSF and cut to the specimen (a thin specimen stays sharp when tilted;
  a slice partly outside the specimen loses that part). This is exact for a perfect crystal slab.
- Resolution metric: for each low-index zone, take the ZOLZ reflections with |g| ≤ 1/lateral and
  |g·n| inside the first lobe of the depth transfer, above exp(−π²/4ln2). The same threshold sets the
  lateral FWHM. The 2D resolution is the worst in-plane direction, 1/min_e max_g |g·e|, and the best
  zone wins. On zone this equals the lateral resolution. Off zone it equals the column smear
  (t·tanθ, or depth-FWHM·tanθ).

Defaults for the MEP model: lateral resolution 0.5 Å, depth resolution 3 nm, slice thickness 2 nm.
The **λ/α²** checkbox next to the depth resolution fills it from the high tension and the
convergence angle and keeps it updated (300 kV: 3.15 nm at 25 mrad, 219 nm at 3 mrad); **λ/β** does
the same for the lateral resolution from the collection angle (0.308 Å at 64 mrad). Typing a value
unchecks the box. Angle fields are typed in mrad and show θ·K in Å⁻¹ in brackets.

These are qualitative tools: feature positions and symmetry are right, and intensities are
approximate.

Version history: [CHANGELOG.md](CHANGELOG.md).

## Develop

```bash
npm ci
npm run dev          # http://localhost:5173
npm test             # vitest: physics core + UI helpers (82 tests)
npm run build:pages  # dist/ (+ dist/zoner.html)
node bench/e2e.mjs --gpu          # headless Chrome: 37 checks, timings, screenshots -> ~/scratch/zoner-bench
node bench/e2e.mjs --swiftshader  # same on software GL (slow-laptop worst case)
```

## Deploy (GitHub Pages)

Live: https://chiahao3.github.io/zoner/ (offline single file: https://chiahao3.github.io/zoner/zoner.html).

`.github/workflows/pages.yml` runs the tests, builds the site plus `zoner.html` and deploys on every
push to `main` (Pages source: **GitHub Actions**). The release steps (version bump, changelog, merge,
tag, push, verify the deploy) are in [PLAN.md §10](PLAN.md#10-releasing-a-version-github--pages).
