# Phase 4 decision memo — drill config + scoring refinement

(Supersedes the Phase 3 memo. Prior memos preserved in git history.)

## Goal
Make the engine configurable on a per-profile basis, tighten scoring so
that "late" is an explicit, configurable threshold (not a side effect of
the response window), surface a per-cue breakdown the athlete can act on,
and add an anti-rhythm signal so the user can spot rhythm-anticipation
patterns before competition.

## Phase 4 acceptance criteria (unchanged from `docs/PHASES.md`)

1. User can create / edit / save drill profiles.
2. Configurable per-profile: cue type set, delay range, late threshold,
   hesitation threshold, response window, scoring weights, round structure,
   distance axis on/off.
3. Hesitation detection uses an explicit, configurable RT band.
4. Choice-RT defaults: hesitation > 450 ms, late > 600 ms (tunable).
5. Per-cue-type RT and error-rate breakdown in the session summary.
6. Anti-rhythm detection: log false-start position in go/no-go sequences
   and surface patterns (e.g. "you false-start most often after 3
   consecutive go cues").

## Non-goals (Phase 4)
- Multi-session trend reporting (Phase 5).
- Taper mode profile generator (Phase 5).
- Video opponent clips (Phase 6).
- Webcam pose detection (Phase 7).

## Key decisions

### D1. Late as a first-class threshold, distinct from the response window
Phase 1–3 conflated two concepts: the *response window* (max time the
cue is on screen waiting for input) and *late* (a response that came in
but past the choice-RT cutoff). The spec is explicit:
- `late` = response after `late_threshold_ms` (default 600 ms)
- `hesitation` = response between `hesitation_threshold_ms` (450) and
  `late_threshold_ms` on a go cue.

New `DrillConfig` field: `lateThresholdMs: number` (default 600).
`responseWindowMs` (default 1200) still exists as the screen-hold
timeout — if no press by then, the rep ends.

Updated classify rule for **go** cues:
- press in [0, hesitationThresholdMs)              → `correct_go`
- press in [hesitationThresholdMs, lateThresholdMs) → `hesitation`
- press in [lateThresholdMs, responseWindowMs]      → `late`
- no press by responseWindowMs                      → `late`

For **no-go** cues, semantics unchanged: any in-window press → `false_start`.

Validation: hesitationThresholdMs ≤ lateThresholdMs ≤ responseWindowMs.

### D2. Drill profiles as named DrillConfig records
- New Dexie table (schema bump to v3): `profiles { id, name, config }`
  plus an `activeProfileId` field on `SettingsRecord`.
- A built-in `default` profile seeds on first boot (identity =
  `DEFAULT_DRILL_CONFIG`). User can create, rename, edit, save-as-new,
  duplicate, delete. Cannot delete the only remaining profile.
- The IdleScreen's Start button uses the active profile.
- The SettingsScreen becomes a profile editor: profile picker → form
  edits live on the current profile → explicit Save commits.

Migration: existing `SettingsRecord` rows lack `activeProfileId`; on
load, the settings module derives a profile from the existing settings
and seeds it as the active "default" profile so the user's Phase 2+
config carries forward.

### D3. Cue subset per profile (`allowedCueIds`)
- `DrillConfig.allowedCueIds: CueId[] | null` (null = all).
- `pickNextCue` filters `CUE_LIBRARY` / `GO_CUES` / `NO_GO_CUES` by
  `allowedCueIds` before sampling.
- Validation: subset must contain at least one go cue *or* (if distance
  axis is enabled and the subset contains any cue that has a go entry
  at any distance) at least one cue capable of producing a go.

For Phase 4 the simpler rule is enough: validation rejects an empty
allowedCueIds and rejects a subset with no go cues when
`distanceAxisEnabled` is false.

### D4. Scoring weights as a configurable map
- `DrillConfig.scoreWeights: Record<RepResult, number>` (default =
  current SCORE_TABLE: correct_go +1, correct_no_go +1, late 0,
  false_start −1, hesitation −2).
- `classifyRep` consults the weights via the input (now plumbed through).
- `summarize` uses the same weights via the per-rep `score` already
  stored on `RepRecord`. No data migration needed.

### D5. Per-cue summary breakdown — pure function returning a structured table
- New pure helper `cueBreakdown(reps): CueBreakdownRow[]` producing
  one row per observed cue id: `{ cueId, reps, correct, falseStarts,
  hesitations, lateMisses, avgRtMs, best10AvgRtMs }`.
- Best-10 = average of the 10 fastest `correct_go` RTs for that cue
  (fewer if fewer correct reps).
- Summary screen renders this as a sortable-by-defaults table replacing
  the existing "By cue" table.
- When the distance axis was active in the session, a secondary
  `cueDistanceBreakdown(reps)` returns one row per `cueId × distance`,
  used to render a compact accuracy heatmap (Phase 5 will polish).

### D6. Anti-rhythm detector — windowed false-start rate
- Pure function `antiRhythmSignal(reps): AntiRhythmStats`:
  - For each rep that is a `false_start` on a go cue, count the number
    of *consecutive* go cues immediately preceding (excluding the
    current rep). Group counts 0, 1, 2, ≥3.
  - Return: `{ falseStartsByPriorGoStreak: Record<0|1|2|3plus, { count, total }> }`.
  - `total` is the count of go-cue reps whose preceding streak was
    that length (denominator).
- Summary screen shows the strongest signal as a short narrative line:
  "False starts most often after 3+ consecutive go cues (X%)" if any
  bucket's rate exceeds the global false-start rate by ≥1.5× and the
  bucket has ≥3 reps. Otherwise: "No rhythm pattern detected."

### D7. Where new state lives
- Engine: `validateDrillConfig` extends to cover the new thresholds and
  cue subset. `cueBreakdown` and `antiRhythmSignal` are pure helpers
  alongside `summarize`.
- Store: new `store/profiles.ts` for Dexie CRUD. Settings module gains
  `activeProfileId` and a `loadActiveProfile()` helper.
- UI: SettingsScreen becomes profile-aware; SummaryScreen renders the
  new breakdown + anti-rhythm line.
- Types: `RepResult` unchanged; `DrillConfig` gets three new fields
  (lateThresholdMs, allowedCueIds, scoreWeights).

### D8. Backward compatibility
- Existing sessions still summarize correctly — `cueBreakdown` is
  derived from `RepRecord.cueId` which all phases populate.
- Settings migration: on load, if no `activeProfileId`, the module
  builds a "default" profile from the current settings, persists it,
  and points the user there.
- DEFAULT_DRILL_CONFIG gains the new fields with defaults that match
  Phase 3 behavior so existing tests keep passing without modification
  (the new lateThresholdMs default of 600 *does* change classification
  behavior — existing tests that exercise classifyRep with go cues at
  RTs ≥ 600 ms will need to be re-evaluated; this is reviewed below).

## Risks and mitigations
- **Late-threshold change reclassifies a band that was previously
  "hesitation".** Mitigation: this is *the* point of the phase — the
  spec is explicit. Verify existing classify tests are still correct
  semantically after the rule change. Tests with hardcoded RT values
  around the 600ms boundary may need updating.
- **Profile schema bump may collide with users who already have a v2
  database.** Mitigation: Dexie versioning is additive; v3 just adds
  `profiles` and uses the existing `settings` row's new field. No
  destructive migration.
- **Anti-rhythm signal noisy with small sample sizes.** Mitigation:
  require ≥3 reps per bucket and ≥1.5× lift over the global rate
  before claiming a pattern.
- **Empty `allowedCueIds` breaks pickNextCue.** Mitigation: validation
  rejects the save; runtime defensively falls back to full library
  with a console warning if somehow it slips through.

## Test strategy
- **classifyRep**: add tests for the lateThreshold boundary (press at
  599 → hesitation, press at 600 → late, press at 601 → late, press at
  responseWindow → late).
- **pickNextCue**: with `allowedCueIds: ['steps_in']`, the only
  returned cue is `steps_in` (and goCueProbability=0 fails because
  no no-go in subset → validate catches it).
- **summarize / cueBreakdown**: produce expected rows for a mixed-cue
  session.
- **antiRhythmSignal**: deterministic sequence of go/no-go reps with
  known prior streaks → expected bucket counts.
- **Profiles store**: `fake-indexeddb` round-trip; load-then-save with
  no rows seeds default; switching active profile persists.
- **Browser**: qa-playwright exercises creating a new profile, editing
  thresholds, running a drill against the profile, observing the new
  per-cue breakdown in the summary, and seeing the anti-rhythm line.

## Rollback path
Phase 4 lives under `app/`. Reverting the phase commit restores Phase 3.
Dexie v3 → v2 is *not* automatic, but v2-only data still loads because
v3 schema is additive. Users who upgrade then downgrade will lose
profiles but keep sessions/reps/settings.

## Out-of-scope deferred
- Cross-session trend analytics → Phase 5
- Taper mode auto-generator → Phase 5
- Video clips → Phase 6
- Webcam pose detection → Phase 7
