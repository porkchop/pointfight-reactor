# Phase 1 decision memo — local MVP cue trainer

## Goal
Ship a fullscreen, low-latency go/no-go reaction trainer the athlete can use in
his gym within two weeks of his next competition. Single drill type, single
input (Space bar), local persistence, immediate per-rep feedback, session
summary on stop.

## Non-goals (Phase 1)
- Drill configuration UI (Phase 2)
- Video opponent clips (Phase 3)
- Configurable input mappings / kiosk polish (Phase 4)
- Pose detection (Phase 5)
- Long-term analytics dashboards (Phase 6)

## Key decisions

### D1. Response model: single commit key
Phase 1 uses one input — **Space = commit**. Response *type* selection
(blitz vs jam vs counter, etc.) is a Phase 2+ concern. This keeps the
perception-action loop pure (see / commit / measure) and matches the spec's
"discourage half-commitments" principle without forcing a key-choice subtask
that itself adds cognitive delay.

A foot pedal in Phase 4 is just another keyboard input mapping to Space, so
this choice does not constrain Phase 4.

### D2. Cue presentation: text + color, not images
Cues render as large high-contrast text on a colored full-viewport background
(green = go, red = no-go). Readable across a gym, no asset pipeline required,
no layout shift between cue types. Image/video cues belong to Phase 3.

### D3. Cue classification (per-rep result)
Given a rep with `cue.isGo`, `pressTime`, `cueShownTime`, `responseWindowMs`,
`hesitationThresholdMs`:

| Cue   | Press relative to cue                          | Result          | Score |
|-------|------------------------------------------------|-----------------|-------|
| go    | press before cue                               | false_start     | -1    |
| go    | press within [0, hesitationThreshold)          | correct_go      | +1    |
| go    | press within [hesitationThreshold, window]     | hesitation      | -2    |
| go    | no press by end of window                      | late            |  0    |
| no-go | press before cue or within window              | false_start     | -1    |
| no-go | no press by end of window                      | correct_no_go   | +1    |

Hesitation vs late is the spec's distinction: a half-go (slow press) is *worse*
than a clean miss, because the rep's purpose is to train commitment.
`hesitationThresholdMs` defaults to 450ms (roughly twice an elite simple-RT)
and is a constant for Phase 1 — Phase 2 will surface it in config.

### D4. Timing source: `performance.now()` everywhere
All cue/press timestamps use `performance.now()` for sub-millisecond
monotonic measurement. `Date.now()` is reserved for session metadata
(start/end wall-clock).

### D5. Random delay before cue
Each rep waits `randInt(preCueMinMs, preCueMaxMs)` (default 1500–4000ms)
before showing the cue. Pressing during this window is a false start.
The RNG is injected into the engine so tests are deterministic.

### D6. State: Zustand for live, Dexie for durable
- Zustand store holds the in-flight drill state (current phase, current cue,
  current rep results). It is throwaway — closing the tab loses it.
- Dexie/IndexedDB stores completed sessions and their reps. Schema:
  - `sessions { id, startedAt, endedAt?, drillType, repCount, summary }`
  - `reps    { id, sessionId, cueId, isGo, result, reactionMs, score }`
- Sessions are written *incrementally* (one session row at start, reps as they
  complete, session updated at stop). If the tab is closed mid-drill the
  partial session remains queryable.

### D7. Engine is a pure module, UI subscribes
The drill engine (`src/engine/drill.ts`) is a pure state machine with no React
or DOM dependencies — input is `{config, now, rng}`, output is rep records
and phase transitions. This is the testable core; the UI is a thin
projection. Justification: spec lists the engine as the primary module
worth getting right, and pure state machines are the only kind of timing
logic that can be unit-tested without flakiness.

### D8. Cue library: static, in-code, eight cues
The spec's eight named cues live in `src/cues/library.ts` as a frozen array
with `{id, label, description, isGo, expectedResponse}`. No DB-backed cue
editing in Phase 1 — that would require schema churn before Phase 2 even
starts.

## Risks and mitigations
- **Timer drift / browser throttling in background tabs.** Mitigation: use
  `performance.now()` and document that the window must stay focused. Phase 4
  fullscreen kiosk mode will harden this further.
- **IndexedDB unavailable in private-window contexts.** Mitigation: catch
  Dexie open errors and degrade to ephemeral mode with a visible banner.
- **Keyboard repeat fires multiple presses.** Mitigation: engine only accepts
  the *first* press per rep; subsequent presses in the same rep are ignored.

## Test strategy
- Unit-test the engine with an injected RNG and a controlled clock (manual
  `now` advance), covering each row of the D3 table.
- Build verification: `tsc -b` (typecheck) + `vite build` succeed.
- Manual browser smoke: run a 5-rep session, confirm summary persists across
  page reload.
- QA-playwright if available; otherwise document the manual repro steps in
  the phase-approval artifact.

## Rollback path
Phase 1 lives entirely under `app/`. Reverting the phase commit restores the
scaffold.
