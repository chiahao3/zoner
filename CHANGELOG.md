# Changelog

All notable changes to zoner. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/) (0.0.x while the UI is still moving).

## [Unreleased]

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
