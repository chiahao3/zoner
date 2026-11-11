# zoner development plan

Living plan for continuing work across sessions.

- **Read §1 first** in a new session.
- Keep §3 (next actions) prioritized.
- Append to §10 (session log) whenever a chunk of work is committed.

---

## 1. Start here

(filled in at the end of session 1)

## 10. Session log

- **2026-11-11, session 1.** Repo created (`main` scaffold, work on `feat/v1-app`).
  - Physics core (`src/physics/`) written test-first: wavelength/sigma, Lobato f_e, lattice,
    structure factors, CIF reader, holder model, zones, two-beam, Bloch wave (real-symmetric
    embedding), projected-resolution metric, stereographic projection. 26 tests pass.
  - Extinction distances at 100 kV, B = 0 vs Williams & Carter Table 13.1: Si 111 61.7 (60.2),
    Si 220 76.2 (75.7), Al 111 55.6 (55.6), Al 200 66.8 (67.3), Al 220 105.7 (105.7) nm.
