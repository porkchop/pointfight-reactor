# Phase 5 decision memo — analytics + taper mode

(Supersedes the Phase 4 memo. Prior memos preserved in git history.)

## Goal
Take everything that is already true *within one session* — per-cue RT, false-start /
hesitation rates, best-10 RT, anti-rhythm — and project it *across sessions* so the
athlete can see whether they are getting better, worse, or stagnating in the two
weeks before competition. Plus: a "taper mode" that uses that history to
auto-generate a low-volume profile that drills only the cues the athlete is
slowest or least accurate on.

## Phase 5 acceptance criteria (from `docs/PHASES.md`)

1. App shows reaction time by cue type (across sessions).
2. App shows false-start rate over time.
3. App shows hesitation rate over time.
4. App shows best-10-rep average and trend.
5. Taper mode profile: short rounds, low total volume, only the cues you are
   slowest or least accurate on.
6. Session-over-session comparison view.

## Non-goals (Phase 5)
- Video opponent clips (Phase 6).
- Webcam pose detection (Phase 7).
- Cross-session storage migration — Phase 4 data model already supports it.
- Chart library — keep dependencies as-is; render trends with text rows + tiny
  inline SVG sparklines.
- Cloud sync / export polish (CSV/JSON export is listed as MVP feature 10 and
  remains deferred; analytics work here uses the data already in IndexedDB).

## Key decisions

### D1. Pure analytics module, separate from drill engine
- New file `app/src/engine/analytics.ts`.
- All Phase 5 aggregation functions are pure: input is `SessionRecord[]` and/or
  `RepRecord[]`; output is plain data structures.
- Keeps `drill.ts` focused on the *real-time* path (cue picking, classification,
  per-session summarize/cueBreakdown/antiRhythmSignal). Cross-session math is
  a different concern with a different read pattern (bulk-fetch from Dexie) and
  different lifecycle (read-only views, no orchestration).
- Mirrors Phase 4 style: `summarize`, `cueBreakdown`, `antiRhythmSignal` are
  already pure in drill.ts. We extend the same pattern, not the same file.

Exports:
```ts
export interface SessionTrendPoint {
  sessionId: string
  startedAt: number
  reps: number
  falseStartRate: number       // false_starts / total reps
  hesitationRate: number       // hesitations / total reps
  lateRate: number             // late / total reps (go cues only denominator)
  avgRtMs: number | null
  best10AvgRtMs: number | null
  score: number
}
export interface CueTrendPoint {
  sessionId: string
  startedAt: number
  cueId: CueId
  reps: number
  avgRtMs: number | null
  errorRate: number            // (1 - correct/reps) for that cue
}
export interface CueAggregate {
  cueId: CueId
  reps: number                 // across sessions
  avgRtMs: number | null
  best10AvgRtMs: number | null
  errorRate: number
  weakness: number             // bigger = worse; see D5
}
export interface SessionDelta {
  baseline: SessionTrendPoint
  candidate: SessionTrendPoint
  deltaAvgRtMs: number | null
  deltaScore: number
  deltaFalseStartRate: number
  deltaHesitationRate: number
  perCue: { cueId: CueId; deltaAvgRtMs: number | null; deltaErrorRate: number }[]
}
export interface TaperRecommendation {
  cueIds: CueId[]
  reason: string
}

export function sessionTrend(sessions: SessionRecord[], repsBySessionId: Map<string, RepRecord[]>): SessionTrendPoint[]
export function cueTrend(sessions: SessionRecord[], repsBySessionId: Map<string, RepRecord[]>): CueTrendPoint[]
export function cueAggregate(allReps: RepRecord[]): CueAggregate[]
export function compareSessions(a: SessionTrendPoint, b: SessionTrendPoint, aReps: RepRecord[], bReps: RepRecord[]): SessionDelta
export function pickTaperCues(aggregate: CueAggregate[], k: number): TaperRecommendation
```

Rationale for shape: the UI wants both per-session-per-cue series (for the
"RT by cue type over time" view — one line per cue, X axis = session index)
and per-session aggregates (for the four overall trend rows). Functions take
the data already pre-grouped so they remain trivially testable.

### D2. Storage read helper
- New helper in `app/src/store/db.ts`:
  - `listRepsForSessions(sessionIds: string[]): Promise<Map<string, RepRecord[]>>`
    uses the existing `reps.sessionId` Dexie index and groups by sessionId in
    a single `where('sessionId').anyOf(...)` query.
- No schema change. No new Dexie version.
- Existing `listRecentSessions(limit = 20)` is the source of "last N sessions"
  for the analytics view; we extend it by accepting a higher limit if needed
  but default to 20 (still cheap, IndexedDB returns under a few KB).
- Existing Phase 4 sessions persist `summary` (a `SessionSummary` snapshot).
  Analytics relies on the *raw reps* not on that summary, so older sessions
  with slightly different scoring weights still display consistently in the
  trend view (the summary's `score` *does* reflect that session's weights,
  which is the right thing — it represents what the user actually saw).

### D3. Best-10 aggregation across sessions
- Two interpretations are valid:
  (a) "best-10 within each session, then plot the per-session best-10 as a
      trend point" — answers "are my fastest reps in a session improving?"
  (b) "best-10 across the entire history window" — answers "what's my current
      ceiling, full stop?"
- Choose **(a)** for the time-series view (the spec line is *"best-10-rep
  average and trend"* — singular per session, plural trend). Choose (b) for
  the Per-Cue Aggregate panel that drives taper-mode picking.
- Both share one helper: `best10AvgOf(times: number[])` → average of the 10
  smallest correct_go RT values (fewer if fewer reps).

### D4. False-start and hesitation rates
- Denominator = *all reps in the session*. The spec talks about overall rates
  and trends; not normalizing to go-cue-only keeps the number directly
  comparable to a casual viewer.
- "lateRate" is included on the trend point for completeness but is not
  required by Phase 5 acceptance — keeping it costs us nothing and means the
  Phase 4 summary can re-use the same trend point shape later.
- Anti-rhythm narrative line stays per-session (Phase 4) — surfacing
  cross-session anti-rhythm patterns is genuinely noisy and is not requested
  by the spec.

### D5. Weakness scoring for taper-cue picking — go and no-go scored separately

Red-team flagged that a single weakness number conflates two things that
shouldn't merge:
- Go cues: weakness is primarily a *speed* problem — `avgRtMs` is the signal,
  with `errorRate` (false-start + late + hesitation, divided by reps for that
  cue) as a tiebreaker.
- No-go cues: there is no RT — `avgRtMs` is structurally `null`. Weakness is
  *only* the false-start rate.

So:
```ts
interface CueAggregate {
  cueId: CueId
  isGo: boolean            // taken from CUE_LIBRARY at aggregation time
  reps: number
  sessions: number         // distinct session count contributing
  avgRtMs: number | null   // correct_go RTs only; null for no-go cues
  best10AvgRtMs: number | null
  errorRate: number        // (reps - correct) / reps; defined for both go and no-go
  goWeakness: number | null    // for go cues only; null for no-go
  noGoWeakness: number | null  // for no-go cues only; null for go
}
```
- Eligibility: `reps ≥ 5` AND `sessions ≥ 2`. (≥5 reps alone admits "one
  bad session" runs; requiring 2 sessions weeds those out.)
- `goWeakness = (avgRtMs / 1000) + errorRate` when both are defined, else null.
- `noGoWeakness = errorRate` for no-go cues, else null.

`pickTaperCues(aggregate, k)`:
- Splits eligible aggregates into go-pool and no-go-pool.
- Default split: take `ceil(k * 0.7)` from the go-pool (sorted by
  `goWeakness` desc, then `cueId` asc for stable tiebreak), and the rest
  from the no-go-pool (sorted by `noGoWeakness` desc, then `cueId` asc).
- If either pool is empty, fill the deficit from the other.
- If total eligible < k, return what we have plus a `reason` string
  ("Not enough data — drilled only 2 cues twice. Drill more variety first.").
- Returned `reason` always names the picked cues and how they were chosen
  (slowest go cues, highest-error no-go cues), so the UI can render a
  transparent banner.

Default K = 3 with the 70/30 go/no-go split → 2 go cues + 1 no-go cue. If a
session is overwhelmingly one or the other, the fill-the-deficit rule
recovers gracefully.

### D5a. Shared `best10AvgOf(times)` helper
Red-team flagged that `cueBreakdown` in `drill.ts` (lines 243-247) already
inlines the best-10 logic. Phase 5 would add a second copy in `analytics.ts`.
Three sites (cueBreakdown, sessionTrend per-session best-10, cueAggregate
global best-10) all encode the same invariant.

Fix: extract `best10AvgOf(times: number[]): number | null` into
`engine/drill.ts` (next to summarize / cueBreakdown), export it, and
refactor `cueBreakdown` to call it. `analytics.ts` imports and reuses it.
One source of truth.

### D6. Taper-mode profile generator
- New button in SettingsScreen → "Build taper profile from recent history".
- Modal/prompt asks for:
  - profile name (default `Taper — YYYY-MM-DD`)
  - sessions to look back (default 5)
  - cues to keep (default 3)
- Clicks "Create":
  - load last N sessions + their reps
  - compute `cueAggregate(reps)` → `pickTaperCues(agg, K)`
  - if recommendation is empty (not enough data): show a banner and bail
  - else build a profile via `buildDefaultProfile({...})` with:
    - `rounds: 3`
    - `workMs: 60_000`
    - `restMs: 30_000`
    - `maxReps: null` (round timing controls volume)
    - `allowedCueIds: recommendation.cueIds`
  - save the profile, set it active, jump back to the profile list with the
    new profile selected.
- The "low total volume" requirement is satisfied by 3×60s/30s and the cue
  subset (fewer cue types = fewer total reps in a fixed time at any given
  inter-cue tempo).

### D7. New screen routing
- App has three top-level phases today: `idle | <drill phases> | ended`.
- Add a UI-only flag `view: 'idle' | 'analytics'` to App's local state, plus
  a "Analytics" link on IdleScreen next to "Settings".
- Analytics screen mounts when `view === 'analytics'`. Has its own back
  button. Does not need session-store state.
- Keeps store unchanged; the analytics view is pure read-from-Dexie.
- Loading state: "Loading sessions…" placeholder while the initial fetch
  is in flight (red-team called this out — IndexedDB load is async).
- Empty state: if zero sessions exist (or all have repCount === 0), the
  screen renders a CTA ("No sessions yet — run a drill first") and a
  back-to-idle link. No table, no compare picker.

### D8. Session-over-session comparison view
- Inside AnalyticsScreen: a "Compare" mode with two `<select>` dropdowns
  defaulting to (second-most-recent as baseline, most-recent as candidate).
- Render `compareSessions(a, b, aReps, bReps)`.
- Top row deltas: avg RT, score, FS rate, hes rate. Color-coded by sign.
- `deltaScore` is suppressed (rendered as "—") when the two sessions used
  different `scoreWeights`, because subtracting scores computed under
  different rules is meaningless. The UI shows a small explanatory tooltip
  "Score weights differed; compare per-result rates instead."
- Per-cue table: red-team flagged four cases that need distinct rendering.
  The compare helper returns one of these classifications per cue:
  - `'both_measured'` — both sessions have ≥1 correct_go rep for the cue:
    delta-RT and delta-error-rate render normally.
  - `'both_error_only'` — both sessions have reps but no correct_go on at
    least one side: delta-RT is null, delta-error-rate renders, row is
    flagged red (this is the regression case red-team flagged — a cue
    that *was* fine and is now 100% errors must not hide behind a null).
  - `'candidate_only'` — cue appeared in candidate but not baseline: row
    annotated "new cue this session" (likely a profile change; not a
    regression).
  - `'baseline_only'` — cue appeared in baseline but not candidate: row
    annotated "not drilled this session" (likely a profile change; not a
    regression).
- Test fixtures cover all four classifications.

### D9. Where new state lives
- Engine: `engine/analytics.ts` (new, pure).
- Store: `db.ts` gains `listRepsForSessions`; nothing else changes.
- UI: `ui/AnalyticsScreen.tsx` (new). `ui/IdleScreen.tsx` adds the link.
  `ui/SettingsScreen.tsx` adds the taper-builder section.
- Types: no breaking changes. `analytics.ts` defines its own view types.
  `engine/types.ts` is untouched.

### D10. Backward compatibility
- Older Phase 1/2/3/4 sessions still appear in the trend view because the
  analytics layer reads from `RepRecord` (cueId / result / reactionMs /
  sessionId / cueShownAt) — every field has been populated since Phase 1.
- Sessions with non-default `scoreWeights` are *not* re-scored; their `score`
  is what the user saw at the time. The trend view shows `score` as-is.
  The comparison view explicitly suppresses `deltaScore` when the two
  sessions used different weights (see D8); the trend chart shows each
  session's score on its own row, no implicit comparison.

## Risks and mitigations
- **Dexie `anyOf(...)` over 20 session IDs returns thousands of reps.**
  Mitigation: a 5-rounds × 120s session at one rep / 3s is ~200 reps; 20 such
  sessions is ~4000 reps. Comfortably under the IndexedDB-cursor-and-render
  budget. We do not paginate.
- **Single-rep outliers skew taper picks.** Mitigation: ≥5 reps per cue floor
  in `pickTaperCues`; reason string makes the basis transparent.
- **Most recent session may be a partial/empty session if the user opened
  and abandoned the app.** Mitigation: the trend view filters out sessions
  with `repCount === 0` for visual clarity (still queryable from compare
  picker if the user wants).
- **Taper profile generator could silently land on a profile with no go
  cues** if the bottom-K is all no-go cues. Mitigation: post-filter — if the
  picked set has no go cue, expand by one until it does, or fall back to
  "not enough variety, please drill more variety first" banner.
- **Comparison view divides by zero** when a session has zero reps of a
  certain cue. Mitigation: helper returns `null` for delta-RT and `0` for
  delta-error-rate when either side has zero reps of that cue (explicit
  "n/a in baseline" marker in the UI).

## Test strategy
- **analytics.test.ts**: deterministic fixture reps spanning two sessions →
  `sessionTrend` returns expected per-session row with hand-computed FS
  rate, hesitation rate, avg-RT, best-10. Mixed-cue fixture →
  `cueTrend`, `cueAggregate` return expected rows.
- **compareSessions edges**: explicit fixtures for all four red-team
  classifications: `both_measured`, `both_error_only` (was-fine-now-100%-
  errors regression), `candidate_only`, `baseline_only`. Plus a fixture
  where the two sessions have different `scoreWeights` → `deltaScore` is
  null (or the helper sets a `weightsDiffer: true` flag).
- **pickTaperCues**: expected top-K with mixed go and no-go cues honors
  the 70/30 split; fallback when go-pool is empty; fallback when no-go-pool
  is empty; eligibility floor (drops cues with reps < 5 OR sessions < 2);
  ties broken by `cueId` ascending; "not enough data" reason string when
  total eligible < K.
- **best10AvgOf** unit-tested directly; `cueBreakdown` regression test
  confirms it still returns the same numbers after the refactor.
- **db.test.ts** (extend existing or add): `listRepsForSessions` round-trips
  reps for a known sessionId set, including the case where one of the IDs
  has zero reps (returns an empty array for that key, not absent).
- **SettingsScreen** (existing test file or new): smoke-test that clicking
  "Build taper profile" with mocked listRecentSessions + listRepsForSessions
  produces a profile with the expected `rounds`, `workMs`, `restMs`,
  `allowedCueIds`.
- **Browser**: qa-playwright runs a fresh session, then a second session,
  opens Analytics, verifies the trend table renders two rows; opens the
  compare picker, picks the two sessions, verifies the per-cue delta table
  renders; builds a taper profile and verifies the new profile appears in
  Settings with the expected reduced cue list.

## Rollback path
Phase 5 lives entirely under `app/`. Reverting the phase commit restores
Phase 4. No Dexie schema bump → no data migration to undo. The taper-built
profile is just another row in the `profiles` table; users who downgrade
keep it but the build-button disappears.

## Out-of-scope deferred
- Video clips → Phase 6
- Webcam pose detection → Phase 7
- CSV/JSON export (MVP feature 10) — still deferred; tracked separately.
- Cross-session anti-rhythm trend — explicitly out of Phase 5 scope.
- Distance-axis-aware analytics breakdown — Phase 4 stored `distance` on
  reps but the cross-session distance × cue matrix is deferred.
