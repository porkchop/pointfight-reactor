# Phase Plan

## Phase 1: Local MVP Cue Trainer ✅ approved
Build a React/TypeScript app with fullscreen cue presentation, randomized
delays, keyboard input, scoring, and local session history.

(Unchanged — already shipped.)

## Phase 2: Physical Input + Round Structure  [PRIORITY — target days 1–3]
Make every rep require a physical commitment (foot pedal), and put reps
inside a workout.

Scope note: phone-as-sensor was descoped to Phase 2b (see `artifacts/decision-memo.md`
and `artifacts/phase-update.json`). The foot pedal already provides the
"real physical commitment" the spec demands; phone-as-sensor is a nice-to-have
that requires its own WebRTC/companion-page infrastructure.

Acceptance criteria:
- USB foot pedal works as a configurable input (rebindable commit key).
- Keyboard input remains as a fallback, flagged in session metadata.
- Session structure supports rounds: configurable work duration, rest
  duration, and round count. Default 2:00 / 1:00 / 5 rounds.
- Between cues, the app shows a continuous-motion indicator (soft pulsing
  metronome or visual bounce) so the athlete is not standing still.
- Pre-cue delay range upper bound configurable up to 8 s.
- Optional penalty counter: false starts and hesitations add reps to a
  during-rest clear-list.

## Phase 2b: Phone-as-Sensor  [post-Phase-5, decomposed into 2b.1–2b.4]
Companion page on a phone on local network sends a "commit" event on
accelerometer threshold (sharp forward step / punch impulse).

Phase 2b is decomposed into four sub-phases. The original Phase 2b acceptance
criteria are split across them. See `artifacts/decision-memo.md` (the
"Phase 2b decision memo — Phone-as-Sensor decomposition") for the planning
record and the cross-cutting red-team resolutions (LAN trust model, WebRTC
test-gate concession, falsifiable motion criteria, Android-gated acceptance
with documented iOS path).

Original Phase 2b acceptance criteria (preserved for traceability):
- Pairing via QR code with local WebSocket or WebRTC DataChannel.
- Accelerometer threshold detection (sharp forward step / punch impulse).
- Calibration screen (per-athlete threshold).
- Session inputSource = 'phone'; flagged in metadata.

Rationale for original deprioritization: requires its own signaling
infrastructure (no server in the project today) plus companion HTML
and sensor calibration. Foot pedal + keyboard cover the "physical
commitment" requirement for the 2-week training window. Phase 2b now
runs post-tournament-prep (post-Phase-5), in four small ships.

### Phase 2b.1: LAN companion + WebRTC DataChannel transport
The athlete's phone loads `/phone` from the laptop on the same Wi-Fi and
establishes a WebRTC DataChannel via manual offer/answer SDP paste in
textareas. This is intentional throwaway UX — 2b.2 replaces paste with QR.

Acceptance criteria:
- `/phone` route exists on the same Vite SPA (route swap in `main.tsx`).
- Loading `http://<laptop-lan-ip>:5173/phone` on an Android phone on the
  same Wi-Fi renders `PhoneApp`.
- Laptop "Pair phone" screen renders the offer SDP in a textarea and
  accepts the answer SDP in another textarea.
- Manual copy/paste of offer onto phone + answer onto laptop establishes
  a `DataChannel` within 5 seconds (verified via manual real-device QA).
- Pressing the phone's "Send commit" button echoes a `{ type: 'commit',
  t: number }` message that the laptop displays as "Last commit at +Xms".
- `SettingsRecord` carries a new optional `laptopLanIp` field.
- `phone/peer.ts` and `phone/wire.ts` are unit-tested under vitest with
  stubbed `RTCPeerConnection`. `phone/peer.test.ts` and
  `phone/wire.test.ts` cover the offer/answer state machine and the
  wire-format JSON round-trip.
- Lint + tsc + vite build clean. Bundle growth budget: +20 KB gzip.
- Manual real-device QA documented at `app/verify-phase-2b1.mjs` +
  `artifacts/phase-2b1-verify/results.json`.

### Phase 2b.2: QR-code pairing flow ✅ shipped
Replace manual paste with QR codes. Laptop renders an offer QR with
`http(s)://<laptop-lan-ip>:5173/phone#offer=<gzipped+base64 offer>`;
phone scans, auto-applies the offer, renders an answer QR; laptop uses
`getUserMedia` + `jsqr` to scan the phone's answer.

Acceptance criteria:
- "Pair phone" screen has three states: showing-offer-QR, scanning-
  answer-QR, connected.
- Phone QR scanner auto-applies the URL fragment offer and renders an
  answer QR within 3 seconds of page load.
- Laptop webcam decode succeeds within 5 seconds of pointing at the
  phone screen.
- Manual textarea path remains available behind a "Show manual pairing"
  toggle (2b.1 scaffolding kept as fallback for cameraless laptops).
- `phone/qr.ts` round-trips a sample SDP through encode/decode; chunking
  kicks in iff the payload exceeds the single-QR threshold.
- Pair UI is lazy-loaded (`React.lazy`) so the QR libraries do not
  inflate the main bundle. Main bundle growth budget: +0 KB gzip.
- Manual real-device QA at `app/verify-phase-2b2.mjs`.

### Phase 2b.3: Accelerometer threshold + calibration ✅ shipped
Phone reads `devicemotion`, computes a peak-impulse metric, fires a
debounced `commit` event when the metric exceeds the athlete's
calibrated threshold. Laptop has a calibration screen that captures
5 sample swings and persists the per-profile threshold to
`ProfileRecord.config.phoneCalibration`.

Acceptance criteria:
- 60s at rest on a flat surface → **0** commit events received.
- 5 deliberate forward-snap impulses → exactly **5** commits.
- Double-snap within 300ms debounce → exactly **1** commit.
- Calibration: 5 sample swings → threshold persists across page reload;
  re-running calibration overwrites the prior value.
- `phone/motion.ts` is pure-function unit-tested with synthesized
  accel streams (still baseline, single impulse, double-tap,
  calibration sequence).
- `docs/SETUP_IOS.md` (new) documents the mkcert path for iOS users.
  iOS acceptance is doc-driven, not CI-gated.
- Android Chrome over plain HTTP: works without permission prompts.
- Manual real-device QA at `app/verify-phase-2b3.mjs`.

### Phase 2b.4: Wire `inputSource = 'phone'` into engine + sessions ✅ shipped
Add `'phone'` to the `InputSource` union; expose phone selection in
Settings; gate Idle/Start on a paired-phone pre-flight; subscribe the
TrainerScreen to the DataChannel and route `commit` messages through
the same `recordPress(at)` path as keyboard/pedal.

Acceptance criteria:
- Settings input-source select offers "Phone (motion)" alongside
  keyboard / pedal.
- If `inputSource === 'phone'` and no DataChannel is connected, Idle
  shows a "Phone not paired — pair now" banner and disables Start.
- With a paired phone, Start runs the drill and commits drive reps.
- Saved `SessionRecord.inputSource === 'phone'`.
- Existing 105+ tests still pass. New tests cover the union widening,
  the IdleScreen pre-flight gate, and the TrainerScreen subscription
  path.
- Manual real-device QA at `app/verify-phase-2b4.mjs` covers the full
  pair → calibrate → drill → summary flow with `inputSource: 'phone'`.

## Phase 3: Visuospatial Cues + Distance Axis  [PRIORITY — target days 3–6]
Replace text cues with animated silhouettes/symbols and add the distance
dimension.

Acceptance criteria:
- Each existing cue type has an SVG silhouette or symbol with a short
  animation (steps in, lifts leg, drops hand, retreats, freezes, fake-step).
- Text labels render only as an optional learning overlay.
- Silhouette renders at three distance sizes: far / mid / in-range.
- Drill profiles can enable the distance axis, where the same cue at
  different ranges maps to different correct responses.
- Optional continuous audio tone whose pitch tracks current rendered
  distance.
- Cue palette and animations are data-driven (JSON or TS map) so new cues
  can be added without code changes.

## Phase 4: Drill Configuration + Scoring Refinement  [target days 6–8]
Make the engine configurable and tighten the scoring so it measures what
the spec claims to measure.

Acceptance criteria:
- User can create / edit / save drill profiles.
- Configurable per-profile: cue type set, delay range, late threshold,
  hesitation threshold, response window, scoring weights, round structure,
  distance axis on/off.
- Hesitation detection uses an explicit, configurable RT band.
- Choice-RT defaults: hesitation > 450 ms, late > 600 ms (tunable).
- Per-cue-type RT and error-rate breakdown in the session summary.
- Anti-rhythm detection: log false-start position in go/no-go sequences and
  surface patterns (e.g. "you false-start most often after 3 consecutive
  go cues").

## Phase 5: Analytics and Competition / Taper Mode  [target days 8–10]
Tournament-prep reporting and a low-volume high-speed mode for the final
days before competition.

Acceptance criteria:
- App shows reaction time by cue type.
- App shows false-start rate over time.
- App shows hesitation rate over time.
- App shows best-10-rep average and trend.
- Taper mode profile: short rounds, low total volume, only the cues you
  are slowest or least accurate on.
- Session-over-session comparison view.

## Phase 6: Video Opponent Mode  [next, decomposed into 6.1–6.3]
Add local video clip import, manual cue-time tagging, and a video-driven
drill mode that reuses the existing rep-scoring engine.

Phase 6 is decomposed into three sub-phases. The original Phase 6 acceptance
criteria are split across them. See `artifacts/decision-memo.md` (the
"Phase 6 decomposition memo — Video Opponent Mode" + "Resolved red-team
blockers — Phase 6" sections) for the planning record, the storage-strategy
trade-off, and the cross-cutting concessions (§B5 browser-API limitations,
§B6 falsifiable acceptance for clip-mode RT).

Original Phase 6 acceptance criteria (preserved for traceability):
- User can import local clips.
- User can tag cue type and cue timestamp.
- App can randomly play clips.
- Reaction timer starts from cue timestamp.
- Results are stored by clip and cue type.

Rationale for original deprioritization (now resolved): building a usable
clip library in two weeks was unrealistic for the pre-tournament window.
Phases 1-5 + 2b.1-2b.4 have shipped; Phase 6 now follows in three small
ships post-tournament.

### Phase 6.1: Clip library — import, store, list, delete
Persist local .mp4 clips as Blobs in Dexie at `version(4)`, alongside an
import / list / delete UI accessible from IdleScreen. The existing
sessions/reps/settings/profiles tables are preserved unchanged.

Acceptance criteria:
- New Dexie schema `version(4)` declares all five tables exactly:
  `sessions: 'id, startedAt'`, `reps: 'id, sessionId, cueId, clipId'`,
  `settings: 'id'`, `profiles: 'id, createdAt'`, `clips: 'id, importedAt'`.
- v3 reps remain readable after the v4 upgrade with no data migration;
  `where('clipId').equals(<any>)` on a pre-v4 rep returns empty.
  Covered by `db.test.ts` v3→v4 upgrade test against `fake-indexeddb`.
- `addClip(blob)` returns
  `{ ok: true; clip } | { ok: false; reason: 'quota' | 'too-large' | 'unsupported-type' | 'storage-error'; message }`.
  Per-clip hard cap: 200 MB. Soft warning toast at >100 MB.
- A unit test stubs Dexie `put()` to throw `QuotaExceededError` and
  asserts `addClip` returns `{ ok: false, reason: 'quota' }`. A second
  test confirms a 250 MB blob returns `{ ok: false, reason: 'too-large' }`.
- `ClipLibraryScreen.tsx` accessible from IdleScreen via a "Manage clips"
  link. Lists clips with name, duration, size; supports `<input
  type="file" accept="video/mp4">` import and delete (with confirm).
- `navigator.storage.estimate()` surface visible in the library screen;
  warning banner at >80 % usage, hard-cap banner at >95 %. Both branches
  unit-tested with a stubbed `estimate()`.
- `docs/QUALITY_GATES.md` §"Browser-API limitations" is updated to add a
  Phase-6 entry alongside Phase 2b (HTML5 `<video>`,
  `requestVideoFrameCallback`, `navigator.storage.estimate`).
- Lint + tsc + vitest + vite build clean. Bundle growth budget:
  +5 KB gzip for the new library screen + Dexie schema.
- Manual real-device QA documented at `app/verify-phase6-1.mjs` +
  `artifacts/phase-6-1-verify/results.json` (import 3 .mp4 clips of
  varying size, reload, delete, verify quota math).

### Phase 6.2: Clip tagging UI
Add a `ClipTagScreen` that records a single `(cueId, cueAtMs)` per clip
using the existing `CUE_LIBRARY` from Phase 3.

Acceptance criteria:
- From ClipLibraryScreen, "Tag" opens `ClipTagScreen.tsx`, prefilled if a
  prior tag exists.
- Tag screen shows `<video controls>` plus a custom scrub bar with
  **−1 frame** and **+1 frame** buttons (step `1/30s`).
- Cue-type select sources from `CUE_LIBRARY` (all 8 entries) and writes
  `clip.cueId` + `clip.cueAtMs` back to Dexie via an in-place update.
- Untagged clips are flagged in the library list ("needs tag") and
  excluded from playback in 6.3.
- Save persists; reload preserves tag.
- `ClipTagScreen.test.tsx` covers cue-id selection and persistence with
  a stubbed `<video>` element.
- Lint + tsc + vitest + vite build clean.
- Manual real-device QA documented at `app/verify-phase6-2.mjs`. Scrub
  precision (within ~1 frame) is a MANUAL gate per §B5 of the
  decision memo.

### Phase 6.3: Clip-mode drill + RT measurement + per-clip results
A `clipmode/runner.ts` Zustand slice drives the `<video>` element, fires
`recordPress`-equivalent commits, and persists results through a new
shared `engine/persistence.ts:commitRep()` helper that **both** the
existing `session.ts` live path and the new clip-mode path call.

Acceptance criteria:
- New pure module `engine/persistence.ts` exposes
  `commitRep({ rep, sessionId, profile, distance })` containing the
  invariants currently inlined in `src/store/session.ts:107-139`
  (rep-id minting, `resolveCueAtDistance`, `roundIndex` + `inputSource`
  fan-out, `persistSession(null)` boundary, `feedback` hand-off).
  Both `session.ts` and `clipmode/runner.ts` call it. A test reverts
  either call site to inline rep-minting and asserts
  `engine/persistence.test.ts` fails.
- `RepRecord` gains `clipId?: string`. `SessionRecord` gains
  `mode?: 'live' | 'clip'` (undefined ≡ `'live'` for back-compat).
- `clipmode/runner.ts` selects clips by **uniform random with
  replacement, no repeat-immediately-previous**. Untagged clips are
  excluded. Distribution test: 200 draws from 5 clips, each appears
  32–48 times. No-repeat-prev test: 100 draws from ≥2 clips, no
  consecutive duplicates.
- IdleScreen adds a segmented control above Start with `data-testid=
  "mode-segmented"` exposing `mode-live` + `mode-clip` options. Default
  `live`. Start dispatches based on selected mode; no second Start
  button. Clip-mode Start inherits the existing phone-pairing gate
  (`phoneSelected && !phoneReady` disables regardless of mode).
- `clipmode/runtime.ts:isClipModeSupported()` returns false when
  `requestVideoFrameCallback` is absent. IdleScreen renders a
  `data-testid="clip-mode-unsupported"` banner ("Clip mode requires
  Chrome 83+, Edge, or Safari 15.4+") and disables Start in that case.
  Unit test stubs `HTMLVideoElement.prototype` without the method.
- Selecting Clip mode with zero tagged clips disables Start with a
  `data-testid="clip-mode-no-clips"` banner pointing to the library.
- `ClipDrillScreen.tsx` mounts `<video>`, drives the runner, renders
  the same feedback UI as TrainerScreen. `cueShownAt = clipStartedAt +
  clip.cueAtMs` computed via `requestVideoFrameCallback` callback
  timestamp.
- Saved `SessionRecord.mode === 'clip'`; each `RepRecord` has the
  correct `clipId`. Phase-5 analytics (`cueBreakdown`,
  `antiRhythmSignal`, `best10AvgOf`) continue to work unchanged on
  the additive fields.
- SummaryScreen shows a per-clip breakdown when `mode === 'clip'`,
  using `cueBreakdown(reps)` filtered by `clipId`.
- Lint + tsc + vitest + vite build clean. Bundle growth budget:
  +6 KB gzip for runner + drill screen + persistence helper.
- Manual real-device QA at `app/verify-phase6-3.mjs`. The ±33 ms cue-
  shown precision criterion is MANUAL per §B5 (requires real
  `<video>` + `requestVideoFrameCallback` against a clip on disk).
- The 6.3 `phase-approval.json` sets `"project_complete": true` at the
  top level; the next iteration writes `artifacts/project-complete.json`
  with `final_phase: "6.3"` and `deferred: ["phase-7"]`.

## Phase 7: Webcam Pose Detection Prototype  [post-tournament]
Add optional webcam-based response detection.

(Acceptance criteria unchanged from original Phase 5.)