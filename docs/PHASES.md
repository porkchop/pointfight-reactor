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

## Phase 2b: Phone-as-Sensor  [post-Phase-3 unless ahead of schedule]
Companion page on a phone on local network sends a "commit" event on
accelerometer threshold (sharp forward step / punch impulse).

Acceptance criteria:
- Pairing via QR code with local WebSocket or WebRTC DataChannel.
- Accelerometer threshold detection (sharp forward step / punch impulse).
- Calibration screen (per-athlete threshold).
- Session inputSource = 'phone'; flagged in metadata.

Rationale for deprioritization: requires its own signaling
infrastructure (no server in the project today) plus companion HTML
and sensor calibration. Foot pedal + keyboard cover the
"physical commitment" requirement for the 2-week training window.

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

## Phase 6: Video Opponent Mode  [post-tournament unless ahead of schedule]
Add local video clip import and manual cue-time tagging.

Acceptance criteria:
- User can import local clips.
- User can tag cue type and cue timestamp.
- App can randomly play clips.
- Reaction timer starts from cue timestamp.
- Results are stored by clip and cue type.

Rationale for deprioritization: building a usable clip library in two weeks
is unrealistic, and animated silhouettes (Phase 3) capture most of the
visuospatial transfer benefit at a fraction of the build cost.

## Phase 7: Webcam Pose Detection Prototype  [post-tournament]
Add optional webcam-based response detection.

(Acceptance criteria unchanged from original Phase 5.)