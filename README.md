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

## Features

- **Cue trainer** — randomized go / no-go cues, configurable pre-cue delay,
  keyboard input, per-rep scoring (correct / late / hesitation / false start).
- **Visuospatial cues** — animated SVG pictographs at far / mid / in-range
  distances, with an optional distance-tracking audio tone and a text overlay
  for learning.
- **Round structure** — configurable work / rest / round count with a
  continuous-motion indicator and an optional penalty clear-list.
- **Physical input** — USB foot pedal (rebindable commit key) or phone-as-sensor
  (accelerometer commit over a WebRTC DataChannel, paired by QR code), with
  keyboard as fallback. Input source is flagged in session metadata.
- **Drill profiles** — create / edit / save profiles: cue set, delay range,
  late + hesitation thresholds, response window, scoring weights, round
  structure, distance axis on/off.
- **Analytics** — reaction time by cue type, false-start and hesitation rate
  over time, best-10-rep average and trend, and a session-over-session
  comparison view, plus anti-rhythm pattern detection.
- **Video opponent mode** — import local .mp4 clips, tag a cue type + cue
  timestamp, then run a clip-driven drill that scores reps off the tagged
  cue moment through the same engine, with a per-clip summary breakdown.

## Project layout

```
app/         Vite + React + TypeScript app
  src/engine/    pure drill engine (cue selection, classification, scoring,
                 analytics, shared rep/session persistence)
  src/cues/      cue library + animated pictographs + palette
  src/audio/     distance-tracking tone synthesis
  src/store/     Zustand + Dexie/IndexedDB persistence
  src/phone/     phone-as-sensor: WebRTC peer, QR pairing, motion detection
  src/clipmode/  video-opponent runner, clip selection, runtime detection
  src/ui/        Idle / Trainer / Summary / Analytics / Settings / Pair /
                 Calibrate / clip library / clip tagging / clip drill screens
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

MVP complete — all planned phases shipped and approved (271 passing tests).

- **Phase 1** — Local MVP cue trainer · ✅ approved
- **Phase 2** — Physical input (foot pedal) + round structure · ✅ shipped
- **Phase 2b** — Phone-as-sensor (WebRTC + QR pairing + accelerometer) · ✅ shipped (2b.1–2b.4)
- **Phase 3** — Visuospatial cues + distance axis · ✅ shipped
- **Phase 4** — Drill configuration + scoring refinement · ✅ shipped
- **Phase 5** — Analytics + competition / taper mode · ✅ shipped
- **Phase 6** — Video opponent mode · ✅ shipped (6.1–6.3)
- Phase 7 — Webcam pose detection prototype · deferred (post-tournament, non-goal for MVP)

See [`docs/PHASES.md`](docs/PHASES.md) for the full phase plan and acceptance criteria.
