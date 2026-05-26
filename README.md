# PointFight Reactor

Local-first browser app for sport karate / point-fighting reaction training.
Randomized go / no-go cues, sub-millisecond reaction-time measurement, immediate
per-rep feedback, and a per-session summary — all offline, no login, all data
stored locally in IndexedDB.

**Live demo:** <https://porkchop.github.io/pointfight-reactor/>

## Quick start

```bash
cd app
npm install
npm run dev      # http://localhost:5173
npm test         # vitest
npm run build    # production build → app/dist
```

## How to train

1. Click **Start drill** (or press Space).
2. Wait through the random pre-cue delay (1.5–4 s).
3. When a cue appears, decide instantly:
   - go cue (e.g. **STEPS IN**, **BLITZES**) → press **Space**
   - no-go cue (e.g. **FAKE STEP**, **BAIT**) → hold position
4. Each rep is scored: correct, late, hesitation, or false start.
5. Press **Esc** to stop and see the session summary.

## Project layout

```
app/         Vite + React + TypeScript app
  src/engine/   pure drill engine (cue selection, classification, summary)
  src/cues/     cue library
  src/store/    Zustand + Dexie/IndexedDB persistence
  src/ui/       Idle / Trainer / Summary screens
docs/        spec, architecture, phase plan, quality gates
artifacts/   per-phase approval and decision artifacts
scripts/     phasekit verification + container setup
```

## Docs

- [`docs/SPEC.md`](docs/SPEC.md) — product spec
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — technical architecture
- [`docs/PHASES.md`](docs/PHASES.md) — phased delivery plan
- [`docs/QUALITY_GATES.md`](docs/QUALITY_GATES.md) — quality gates and audit-first workflow

## Status

- **Phase 1** — Local MVP cue trainer · ✅ approved
- Phase 2 — Drill configuration · pending
- Phase 3 — Video opponent mode · pending
- Phase 4 — Foot pedal / kiosk mode · pending
- Phase 5 — Webcam pose detection prototype · pending
- Phase 6 — Analytics and competition mode · pending
