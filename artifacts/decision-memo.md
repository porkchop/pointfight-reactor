# Phase 2 decision memo — round structure + configurable input

(Supersedes the Phase 1 memo. The Phase 1 memo is preserved in git history;
the most recent memo is the one of record per `QUALITY_GATES.md` §"Planning gate".)

## Goal
Make every rep require a physical commitment, place reps inside a workout
structure, and surface enough configuration that the athlete can use the app
in his real gym setup before competition (2 weeks out).

## Scope decision: split Phase 2

`docs/PHASES.md` Phase 2 originally bundled seven acceptance criteria. One —
phone-as-sensor with QR-paired WebRTC DataChannel and accelerometer
threshold detection — requires its own substantial infrastructure (signaling
server or signaling-free pairing, companion HTML, sensor calibration). It
is the most uncertain piece and not strictly required for the athlete's
2-week training window: USB foot pedals already provide the "real physical
commitment" the spec demands.

Decision: **defer phone-as-sensor to a new Phase 2b**. Phase 2 ships with
the remaining six criteria. Phone-as-sensor becomes Phase 2b, scheduled
after Phase 3 (visuospatial cues) unless time remains before competition.

`docs/PHASES.md` is updated accordingly; `artifacts/phase-update.json`
records the change. Approved phase numbering (Phase 1) is unchanged.

## Phase 2 (revised) — acceptance criteria

1. USB foot pedal works as configurable input (rebindable commit key).
2. Keyboard input remains as fallback, **flagged in session metadata**.
3. Session structure supports rounds: configurable work / rest / count
   (default 2:00 / 1:00 / 5).
4. Between cues, a continuous-motion indicator shows so the athlete is
   not standing still.
5. Pre-cue delay upper bound configurable up to 8 s.
6. Optional penalty counter: false starts and hesitations add reps to a
   during-rest clear-list.

## Non-goals (Phase 2)
- Phone-as-sensor (Phase 2b).
- Visuospatial silhouette cues (Phase 3).
- Drill-profile CRUD (Phase 4).
- Multi-input simultaneous (e.g. pedal + phone) — single input source per
  session, switchable on idle screen.

## Key decisions

### D1. Round model: add `rounds`, `workMs`, `restMs` to `DrillConfig`
`DrillConfig` already lives in `engine/types.ts` and flows through the
Zustand store. Round structure is a natural extension. New fields:

```
rounds:  number   // default 5
workMs:  number   // default 120_000
restMs:  number   // default 60_000
```

Engine adds a `roundIndex` (0-based) to in-flight state and a `workEndAt`
timestamp set when each round begins. A new phase value `'rest'` joins
`'waiting' | 'showing' | 'feedback'`. Transition rules:

- on `start()`: roundIndex = 0, workEndAt = now + workMs, phase = 'waiting'
- on `recordPress`/`finishWindow`: if `performance.now() >= workEndAt`,
  transition into `'rest'` after feedback instead of `beginRep`.
- on rest timer expiry: increment roundIndex; if `>= rounds`, `phase = 'ended'`
  via `stop()`; else reset workEndAt and `beginRep`.

Round transitions are deterministic and unit-testable with an injected
clock identical to Phase 1's RNG injection.

### D2. Input source: keyboard vs pedal flag (no auto-detect)
Foot pedals enumerate as standard HID keyboards. We cannot reliably
distinguish "user pressed a key with their finger" from "user pressed a
key with their foot" at the JS layer. So:

- Settings screen has an explicit toggle: **Keyboard (dev/fallback)** /
  **Foot pedal**.
- Settings screen also lets the athlete rebind the commit key (default
  Space; pedals are commonly preconfigured to Space already, but some
  pedals emit Enter, F12, etc.).
- The toggle value is stamped on the session record as `inputSource`
  and shown on the summary screen.
- A small banner appears on the idle screen if the active source is
  `keyboard`: "Keyboard mode — pedal recommended for live drilling".

Operational consequence: keyboard remains usable for setup/dev and is
explicitly labelled as a fallback in stored metadata, matching the
spec's intent.

### D3. Continuous-motion indicator: CSS-only pulse, between cues
A single absolutely-positioned circle on the trainer stage. CSS
`@keyframes` pulses scale + opacity at ~110 BPM. Visible only when
`phase === 'waiting'`. No JS timer, no per-frame state updates. Zero
runtime cost beyond GPU compositing. This is the simplest thing that
encodes the spec's "continuous-motion expectation" without introducing
audio assets or new timing concerns.

A future Phase 3/4 can replace this with the visuospatial cue silhouette
when those land. For Phase 2 a soft pulse is sufficient.

### D4. Pre-cue delay extension: just relax bounds + add validation
`preCueMaxMs` currently defaults 4000. Spec says configurable up to 8000.
No engine change required — `pickPreCueDelayMs` already accepts whatever
bounds the config gives it. Settings UI exposes the two numbers with
inline validation:

- 500 ≤ preCueMinMs ≤ preCueMaxMs ≤ 8000

Validation lives in a single `validateDrillConfig()` helper in
`engine/drill.ts` so it can be reused by tests and the UI form.

### D5. Penalty counter: derived, not stored separately
Penalties are a *view* over the existing rep stream — no new persistent
field needed. A pure helper `pendingPenalties(reps, perFalseStart,
perHesitation, cleared)` returns the current outstanding count.

- `cleared: number` is a new field on the session record (default 0).
- The athlete clicks "Clear N reps" on the rest screen; the store
  increments `cleared` by 1 each click (and persists the session).
- Optional toggle on the settings screen: `penaltyCounterEnabled`. When
  off, the clear-list is hidden but rep classification is unchanged.

This keeps penalties as a derived view, which means importing a session
later (CSV export, Phase 4) does not depend on a separate table.

### D6. Settings persistence: small `settings` Dexie table, single row
Add a `settings` store keyed by literal `'singleton'`. Fields:

```
{
  id: 'singleton',
  commitKey: 'Space' | string,       // e.g. KeyboardEvent.code
  inputSource: 'keyboard' | 'pedal',
  rounds, workMs, restMs,
  preCueMinMs, preCueMaxMs,
  penaltyCounterEnabled: boolean,
  perFalseStartPenalty, perHesitationPenalty,
}
```

Loaded on app boot, persisted on every settings save. Simpler than a
flat `localStorage` adapter and gives us migration paths (Dexie
versioning) when Phase 4 expands drill profiles. Migration: `db.version(2)`
adds the `settings` store; `version(1)` data is untouched (sessions/reps
schemas unchanged for Phase 2).

### D7. Where new state lives
- Engine module additions: `validateDrillConfig`, `pendingPenalties`,
  round-state transition helpers. Pure functions; unit-tested.
- Zustand store: `roundIndex`, `workEndAt`, `restEndAt`, `cleared`,
  `inputSource`. Orchestration only — no domain logic in the store.
- New `store/settings.ts` for the Dexie settings table getter/setter.
- New `ui/SettingsScreen.tsx` reachable from idle screen.
- New `ui/RestScreen.tsx` shown during inter-round rest with: round
  number, time remaining, penalty clear-list (if enabled), Skip button.

### D8. Backward compatibility with Phase 1 data
- Existing `sessions` rows from Phase 1 have no `rounds` / `workMs` /
  `inputSource` / `cleared` fields. Treat missing fields as defaults
  when listing recent sessions.
- The default `start()` (no overrides) uses the new defaults but does
  not require explicit round structure to function — passing
  `rounds: 1, workMs: Infinity` reproduces Phase 1 behavior (used in
  existing unit tests). This preserves the Phase 1 behavior contract.

## Risks and mitigations
- **Round timer drift across the rest screen.** Mitigation: drive both
  work and rest from `performance.now()` absolute deadlines, not
  setTimeout-accumulated intervals. The trainer's existing tick uses
  this pattern already.
- **`Space` rebind conflicts with the existing `Space=acknowledge feedback`
  shortcut.** Mitigation: the commit key and the acknowledge key are
  treated as the same key by intent — feedback advances on commit key
  press. The rebind covers both uses simultaneously.
- **Settings table absent on first run.** Mitigation: settings getter
  seeds defaults if the row is missing.
- **`KeyboardEvent.code` may differ across layouts for non-letter pedals.**
  Mitigation: capture `event.code` (the physical key id, layout-independent)
  rather than `event.key`. Display the code to the user during rebind.

## Test strategy
- **Engine**: extend `engine/drill.test.ts` with `validateDrillConfig`
  edge cases (lower bound, upper bound, inversion) and `pendingPenalties`
  (counts, clearing).
- **Round transitions**: new `engine/rounds.test.ts` driving the
  transition helper with a controlled clock through work → rest →
  next work → ended.
- **Store**: extend `store/session.test.ts` with a round-end branch and
  the cleared counter.
- **Settings**: `store/settings.test.ts` against `fake-indexeddb`
  covering seed-on-missing and persistence round-trip.
- **UI**: settings form validation rejects invalid bounds (Vitest +
  jsdom).
- **Browser**: qa-playwright exercises a 2-round drill end-to-end:
  starts → fires reps → enters rest with clear-list visible →
  finishes round 2 → summary lists `inputSource: keyboard`.

## Rollback path
Phase 2 lives entirely under `app/`. Reverting the phase commit
restores Phase 1 behavior. Dexie schema bump (`version(2)` adding
`settings`) is additive — Phase 1 stores remain queryable; rolling
back simply leaves an unused IndexedDB store, which Dexie ignores
on the prior version constructor.

## Out-of-scope deferred to later phases
- Phone-as-sensor → Phase 2b (now added to `docs/PHASES.md`).
- Per-cue-type RT breakdown / drill-profile CRUD → Phase 4.
- Visuospatial silhouettes → Phase 3.
- Analytics-over-time views → Phase 5.
