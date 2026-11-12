# zoner

A browser tool for tilting crystals onto a zone axis at the microscope. Every panel shares one
double-tilt holder state, and you can tilt from any of them with the mouse or the arrow keys.

| panel | what it shows |
|---|---|
| **Diffraction** | Reflections at their excitation error, as SAED spots or CBED disks. Kikuchi bands. An arrow to the nearest zone axis with its angle. Choice of theory: kinematic, per-reflection two-beam (dynamical, real time), or a many-beam Bloch wave computed whenever you stop moving. |
| **Resolution stereogram** | A map centred on the beam, coloured by the projected 2D resolution you would get if you tilted to that direction. It responds to the slice thickness, depth resolution and total thickness. Zone markers are coloured by the resolution reached *on* that zone. Hatching marks orientations beyond the holder limits. |
| **Real space** | The specimen slab, with slice boundaries and the current MEP slice highlighted, or a unit-cell cluster. |
| **Depth sum / MEP slice** | The phase image σ∫V dz of the tilted crystal. Tilt smears the columns by t·tanθ. |
| **Orientation** | α, β and the beam direction. The nearest zones with the α/β needed to reach each one, and a "go" button for each. The current 2D resolution and the column smear. |

Built-in crystals are Si, SrTiO3, Al, Au, Cu, GaAs, MgO, Fe (bcc) and GaN (wurtzite). Any CIF that
lists its symmetry operators can be loaded, either with **CIF…** or by dropping the file on the page.
Training mode starts you a few degrees off a low-index zone with only the DP visible, and times how
long it takes you to get on zone.

## Use

- Hosted: GitHub Pages (see "Deploy").
- Offline: `zoner.html` is a single 640 kB file that runs from disk with no network. It is linked in
  the help dialog and built by `npm run build:single`.
- Keys: ← → ↑ ↓ tilt (the pattern moves the way of the arrow; Shift ×5, Alt ×0.2). Q/E rotate in
  plane. Z goes to the nearest zone, 0 sets α = β = 0, T toggles training, H shows a hint, ? opens help.
- **Link** copies a URL that restores the crystal, the orientation and every setting.

## Physics, briefly

- Electron scattering factors: Lobato & Van Dyck, *Acta Cryst.* A70, 636 (2014). Debye-Waller B is
  0.5 Å² by default. U_g = γF_g/(πΩ). Extinction distances agree with Williams & Carter to within 2.5%
  (see `PLAN.md` §8).
- The beam travels along −z. s_g = (K² − |k₀+g|²)/2K. Two-beam: I = sin²(πts_eff)/(ξs_eff)².
  Bloch: ψ(t) = exp(iπtA/K)e₀, using a real-symmetric embedding of the Hermitian A (JAMA
  tred2/tql2). There is no absorption.
- Images use Fourier synthesis of V_g × lateral Gaussian × depth transfer (box × Gaussian for a slice,
  box for the depth sum). This is exact for a perfect crystal slab.
- Resolution metric: for each low-index zone, take the ZOLZ reflections with |g| ≤ 1/lateral and
  |g·n| inside the first lobe of the depth transfer, above exp(−π²/4ln2). The same threshold sets the
  lateral FWHM. The 2D resolution is the worst in-plane direction, 1/min_e max_g |g·e|, and the best
  zone wins. On zone this equals the lateral resolution. Off zone it equals the column smear
  (t·tanθ, or depth-FWHM·tanθ).

These are qualitative tools: feature positions and symmetry are right, and intensities are
approximate.

## Develop

```bash
npm ci
npm run dev          # http://localhost:5173
npm test             # vitest, physics core (29 tests)
npm run build:pages  # dist/ (+ dist/zoner.html)
node bench/e2e.mjs --gpu          # headless Chrome: smoke, 12 interaction checks, timings, screenshots
node bench/e2e.mjs --swiftshader  # same on software GL (slow-laptop worst case)
```

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` runs the tests, builds the site plus `zoner.html` and deploys on every
push to `main`. Do this once on GitHub: Settings → Pages → Source: **GitHub Actions**.
