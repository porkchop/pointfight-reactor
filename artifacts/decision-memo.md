# Phase 3 decision memo — visuospatial cues + distance axis

(Supersedes the Phase 2 memo. Prior memos preserved in git history.)

## Goal
Replace text cues with visual silhouettes/symbols, add the distance axis
(far / mid / in-range) as a second decision dimension, and make the cue
palette data-driven so new cues can be added without code changes.

## Phase 3 acceptance criteria (unchanged from `docs/PHASES.md`)

1. Each existing cue has an SVG silhouette/symbol with a short animation.
2. Text labels render only as an optional learning overlay.
3. Silhouette renders at three distance sizes: far / mid / in-range.
4. Drill profiles can enable the distance axis — same cue at different
   ranges maps to different correct responses.
5. Optional continuous audio tone whose pitch tracks current rendered
   distance.
6. Cue palette and animations are data-driven (JSON or TS map) so new
   cues can be added without code changes.

## Non-goals (Phase 3)
- Per-cue-type RT breakdown in summary (Phase 4).
- Anti-rhythm detection (Phase 4).
- Long-term analytics-over-sessions trends (Phase 5).
- Real-photo or video clip cues (Phase 6).
- Distance from a real depth source (webcam, sensor) — distance is
  rendered, not measured.

## Key decisions

### D1. Silhouette style: simple high-contrast pictographs, not realistic figures
The athlete needs the cue to be readable at a glance from across a gym.
A photoreal silhouette would take a real illustrator and produce slower
reads than a clean icon. We render each cue as a stylized pictograph —
person-shaped, single accent color per action, ~60 lines of SVG max.

Tradeoff considered: detailed silhouettes look better in marketing but
are slower to read under fatigue. The spec's "perception-action coupling"
principle prefers clarity over realism. Phase 6 (video) handles realism.

### D2. Animation: CSS keyframes on SVG sub-elements, not SVG SMIL or runtime libraries
- CSS `@keyframes` driving `transform` on specific SVG groups (leg lifts,
  arm drops, body steps in, etc.).
- No SMIL (deprecated in modern browsers for cross-platform parity).
- No Lottie/Framer in this phase — adds dependency weight and a runtime
  cost the spec does not need.
- Each cue's animation triggers on mount; React re-mounts the component
  on cue change via `key={cueId + repId}`.

### D3. Distance axis: per-rep distance, opt-in via config, conditional rule table
- New `DrillConfig` field: `distanceAxisEnabled: boolean` (default false
  — backward compatible with Phase 2).
- When enabled, the engine picks a distance per rep (`'far' | 'mid' | 'in_range'`)
  with uniform probability by default.
- A cue's expected response when distance is on comes from
  `cue.distanceResponses?.[distance]` if present, else falls back to
  `cue.expectedResponse`. Cues that benefit from distance (e.g. a step-in
  is a `jam_entry` at far range but a `stop_kick` at in-range) declare
  the full table; cues that are distance-agnostic (e.g. `freezes`)
  declare only the base response.
- `RepRecord` gains an optional `distance?: Distance` field. Phase 2
  reps lack it; the type is optional so reading old rows still works.
- Classification logic is otherwise unchanged: go/no-go derivation,
  hesitation/late thresholds, false-start rule all stay in place.

### D4. Distance rendering: CSS transform scale on a wrapper element
- far → 0.45
- mid → 0.7
- in_range → 1.0
- The same SVG renders in all three; only the wrapper's transform scales.
- Smooth interpolation is **not** required for Phase 3 — distance is
  set at cue-reveal time and held for the rep's duration.

### D5. Audio tone: Web Audio OscillatorNode, optional, silent on init failure
- New `audioToneEnabled: boolean` setting (default false — audio is
  opt-in for a gym environment that may already be loud).
- One `AudioContext` lazily constructed at first cue. A single
  `OscillatorNode` started on cue reveal; frequency set from distance:
  - far → 220 Hz
  - mid → 440 Hz
  - in_range → 660 Hz
- Stopped on rep end (commitRep). Disconnects oscillator and creates a
  fresh one each rep (oscillators are single-use per spec).
- Gain node ramps in/out 30ms to avoid clicks.
- If `AudioContext` construction throws (older Safari, restricted
  contexts) the audio module silently no-ops; the rest of the app
  works normally.

### D6. Cue palette is data-driven
- New `app/src/cues/palette.ts` maps each cue id to:
  ```
  {
    id, label, description, isGo, expectedResponse,
    distanceResponses?: Record<Distance, ResponseId>,
    Pictograph: React.FC,            // the SVG component
    accentColor: string,             // CSS color (gym-correct / gym-warn etc.)
  }
  ```
- `library.ts` re-exports the legacy `CUE_LIBRARY` / `GO_CUES` /
  `NO_GO_CUES` shape (engine still consumes those for cue picking) but
  the *visual* data lives in `palette.ts` so adding a cue means adding a
  palette entry plus an engine-side entry — both purely additive.
- Future Phase 4 drill profiles can subset the palette by id.

### D7. Where the new state lives
- Engine: `pickDistance` pure function with injected RNG; `expectedResponseFor(cue, distance)` helper that consults the rule table.
- Store: `distanceAxisEnabled`, `audioToneEnabled`, `textOverlayEnabled`
  flow through `DrillConfig`; rep records optionally carry `distance`.
- Settings UI: three new toggles in a new "Visuals" section.
- UI: new `CueStage.tsx` component that renders the active cue's
  Pictograph at the correct distance scale, with optional text overlay.
- Audio: new `audio/distanceTone.ts` module (start/stop functions, lazy
  AudioContext, no global state besides the singleton context).

### D8. Backward compatibility with Phase 1 + 2
- `distance` is optional on `RepRecord`. Phase 1/2 reps lack it.
- `distanceResponses` is optional on each palette entry.
- `distanceAxisEnabled` defaults false; existing recent-sessions UI
  behaves identically when the user has never toggled it on.
- Text cue labels are preserved (the spec keeps them as an overlay)
  so the recent-sessions display and summary by-cue table still work.

## Risks and mitigations
- **SVG complexity bloats bundle.** Mitigation: pictographs are ≤60 lines
  of inline SVG each; ~480 lines total, well under 10kB after minification.
- **Audio autoplay restrictions.** Mitigation: AudioContext is constructed
  on first user gesture (Start drill click) — browsers permit audio after
  a user gesture, before is unreliable. The drill start *is* a user gesture.
- **Animation jank under heavy CSS.** Mitigation: animations target
  `transform` only (GPU-composited). No layout-triggering properties.
- **Distance-axis-on with cues that have no `distanceResponses`.**
  Mitigation: fall back to the cue's base `expectedResponse`. Optional
  warning in console if a cue lacks a distance table; not a runtime error.

## Test strategy
- **Engine**: extend `engine/drill.test.ts` with:
  - `pickDistance` distribution check (uniform across far/mid/in-range)
  - `expectedResponseFor` with and without `distanceResponses`
- **Cue palette**: `cues/palette.test.ts` ensuring every CUE_LIBRARY entry
  has a matching palette entry with a Pictograph component.
- **Store**: extend `store/session.test.ts` with a rep stamped with
  `distance` when `distanceAxisEnabled: true`.
- **Settings**: round-trip the three new toggles.
- **UI**: smoke-test that CueStage renders an SVG and the text overlay
  visibility toggles correctly (Vitest + jsdom).
- **Browser**: qa-playwright cycles through several reps with distance
  axis on; verifies different scale classes; checks audio toggle does
  not break the drill; takes screenshots of all three distance sizes.

## Rollback path
Phase 3 lives under `app/`. Reverting the phase commit restores Phase 2
behavior. No DB schema bump required (RepRecord.distance is optional).

## Out-of-scope deferred to later phases
- Per-cue-type RT/error breakdown in summary → Phase 4
- Anti-rhythm detection → Phase 4
- Multi-session analytics → Phase 5
- Photoreal or video cues → Phase 6
