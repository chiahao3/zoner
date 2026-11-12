# Changelog

All notable changes to zoner. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/) (0.0.x while the UI is still moving).

## [Unreleased]

Session 2 (branch `feat/session-2`; becomes 0.0.2 when merged).

### Changed
- Workspace is a 2×2 grid that always fits the window (no page scroll on desktop): diffraction
  space on the left (DP over stereogram), real space on the right (crystal model over image). The
  orientation panel moved to a collapsible right rail (ⓘ). Phones still stack one column.
- Depth sum and MEP slice share one **Real-space image** panel with a toggle; depth sum is the
  default. The slice-depth slider sits in the panel header in slice mode.
- One **convergence angle** for everything (default 3 mrad). Parallel vs CBED is automatic: α = 0
  is parallel; disks are drawn as CBED once larger than the spot size. The DP names the mode.
  The separate illumination switch and DP convergence entry are gone.
- Holder limits are labelled "α/β range ±" and the orientation panel spells out the symmetric
  range (α −35° … +35°).
- CBED display uses √ scaling unless the disks really overlap.
- e2e output goes to `~/scratch/zoner-bench` (local disk) by default.

### Added
- Stereogram: dashed rings of total tilt from the current orientation, labelled in degrees, and a
  hover readout of the tilt and the α/β needed for the direction under the pointer.
- Crystal model: legend of each atomic species (colour, symbol, sites per cell).
- Links carry `v=2`; links from 0.0.1 are migrated (DP convergence → the single angle).
- Tests: `tests/ui.test.ts` (auto illumination, ring spacing, canvas sizing, species legend, link
  migration); e2e grew from 12 to 23 checks (layout fit at four window sizes, image toggle, legend,
  illumination, rings, hover, phone stacking), then 26 (rings toggle, map follows the image, holder
  switch).

### Changed (session 2, second round)
- Tilt rings are off by default (the hover readout gives the same number); **Rings** button in the
  stereogram header.
- The λ/2α and λ/α² estimate buttons are gone. Defaults: lateral resolution 0.5 Å, depth
  resolution 3 nm (was 4.9 nm).
- The stereogram colouring follows the image toggle (depth sum or MEP slice); the separate map
  source setting is gone. Default is depth sum for both.
- Holder range is a switch in the orientation panel, off by default. Switching on takes the
  current orientation as the stage α/β reading (prefilled, editable) and then enforces the range and
  hatches the map.

### Changed (session 2, third round)
- Resolution colour scale runs from the lateral resolution to 1.5 Å; anything coarser is not atomic
  resolution, so it is grey on the map and reads "> 1.5 Å" in the orientation panel (was 2.5 Å).
- The holder range switch engages at any time. With no reading typed, the stage reading is the
  current α/β if inside the range, otherwise 0, 0 (the orientation is always kept). Re-engaging
  re-anchors. New shortcut **L** toggles it, also with the orientation panel hidden.

### Fixed
- Arrow keys stopped working after clicking a checkbox.
- Canvases capped at their maximum backing size kept the cap per side, which stretched non-square
  panels; both sides now scale together.

## [0.0.1] - 2026-11-11

First working version (session 1).

### Added
- Physics core (TypeScript, unit-tested): relativistic constants, Lobato & Van Dyck electron
  scattering factors (Z = 1–103), lattices, structure factors with Debye-Waller, CIF parser with
  symmetry-operator expansion (P1 fallback with a warning), double-tilt holder model, zone
  enumeration (3- and 4-index), kinematic and per-reflection two-beam diffraction, many-beam Bloch
  wave (real-symmetric embedding, JAMA eigensolver), and a per-zone projected-resolution metric.
- Built-in crystals: Si, SrTiO3, Al, Au, Cu, GaAs, MgO, Fe (bcc), GaN (wurtzite); CIF upload by
  button or drag-and-drop.
- Panels sharing one tilt state: diffraction pattern (SAED spots or CBED disks, Kikuchi bands,
  nearest-zone arrow), resolution stereogram, 3D slab / unit-cell view, depth-sum image, MEP-slice
  image, orientation info with "go" buttons.
- Tilt by drag in any panel, arrow keys (Shift ×5, Alt ×0.2), Q/E in-plane rotation, Z to the
  nearest zone; holder-limit clamping with a toast.
- Training mode (easy/medium/hard) with timing and best times.
- URL-hash state ("Link"), localStorage persistence, light/dark theme, help dialog.
- Single-file offline build (`zoner.html`), GitHub Pages workflow, headless-Chrome e2e harness with
  timings and screenshots.
