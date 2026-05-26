# PointFight Reactor

## Purpose
PointFight Reactor is a local-first browser application for sport karate / point
fighting reaction training. It helps the athlete rebuild fast decision commitment
by presenting randomized visuospatial cues, opponent video clips, go/no-go
situations, and measurable reaction drills — coupled to a real physical response.

The app is designed for solo training in a home gym using a laptop or large
screen, pads, a foot pedal or phone-as-sensor for physical input, and an
optional webcam.

## Primary User
A high-level point fighter preparing for competition in 2 weeks. The athlete is
already fit and technically skilled. The problem is not conditioning; the
problem is hesitation, over-analysis, and delayed commitment under visual
uncertainty.

## Core Training Principle
The app trains perception-action coupling:

- See a specific opponent trigger.
- Commit instantly to a preselected physical response.
- Reset, keep moving.
- Measure correctness, reaction time, and hesitation.

The app should discourage half-commitments. In scoring, hesitation is worse
than a clean wrong decision. Reps must require a physical commitment, not a
keyboard tap from a seated position — keyboard input is supported only as a
fallback for setup and development.

## Training Goals This App Supports
- **Decision-making** under visual uncertainty (go/no-go discrimination).
- **Reaction speed** measured from a visual cue to a real motor commitment.
- **Distance management** as a second decision axis (cue + range → response).
- **Workout load**: reps live inside timed rounds with continuous movement
  between cues, not seated reaction-time testing.

## MVP Features
1. Fullscreen drill mode.
2. Randomized cue presentation with visuospatial (not text-only) cues.
3. Configurable pre-cue delay range with continuous-motion expectation.
4. Go/no-go cue logic with optional distance modifier.
5. Physical response input: foot pedal (USB HID), phone-as-sensor
   (accelerometer threshold), or keyboard fallback.
6. Reaction-time measurement with choice-RT thresholds (not simple-RT).
7. Correct / late / false-start / hesitation scoring with operationalized
   hesitation definition.
8. Round-based session structure (configurable round length and rest).
9. Session history saved locally.
10. CSV/JSON export.
11. Simple drill configuration screen.

## Cue Representation
Cues are presented as animated silhouettes or symbols, not English text.
Text labels are available as a learning/debug overlay only.

Each cue has:
- a visual form (SVG animation or symbol)
- a cue type
- an optional distance attribute (far / mid / in-range)
- a go/no-go classification (which may depend on distance)

## Cue Types
- opponent steps in
- opponent blitzes
- opponent lifts lead leg
- opponent drops lead hand
- opponent retreats
- opponent freezes
- opponent fake-steps
- no-go bait

## Response Types
- blitz
- stop-kick
- angle counter
- jam entry
- evade/reset
- do nothing

## Distance Axis
Each go cue may carry a distance attribute that changes the correct response:
- **Far**: most cues are no-go; pressure or reset only.
- **Mid**: blitz / jam window; the primary commit zone.
- **In-range**: stop-kick, jam entry, or evade — never a clean blitz.

Distance is rendered visually via silhouette size and optionally via a
continuous audio tone whose pitch tracks range.

## Drill Types

### First Beat
A cue appears. Athlete must respond immediately with one committed scoring
action.

### Go / No-Go
Some cues are valid openings. Others are baits. Athlete responds only to
valid triggers.

### Counter Entry
Athlete reacts to incoming attacks with a preselected counter.

### Rhythm Break
Athlete attacks when the opponent's movement rhythm changes.

### Tournament Start
Simulates bow/start/first exchange/reset.

### Round Workout
Drill runs inside fixed-length rounds (default 2:00 work / 1:00 rest, configurable)
with continuous movement expected between cues. Optional penalty counter
(e.g. burpees added to a rest-period clear-list) for false starts and
hesitations.

## Scoring
Each rep records:
- cue id
- cue type
- distance (if applicable)
- expected response
- athlete response (input source: pedal / phone / keyboard)
- reaction time (ms)
- correct / incorrect
- false start (input before cue)
- late response (input after the choice-RT threshold)
- hesitation (input within window but above the hesitation threshold)

Operational definitions:
- **Late** = response after `late_threshold_ms` (default 600 ms).
- **Hesitation** = response between `hesitation_threshold_ms` (default
  450 ms) and `late_threshold_ms`, on a go cue.
- **False start** = input received during the pre-cue delay window.

Suggested scoring:
- correct go: +1
- correct no-go: +1
- late go: 0
- false start: -1
- hesitation / half-go: -2

## Session Summary
Beyond aggregate stats, the summary breaks down:
- RT mean / median / best-10-avg per cue type
- error rate per cue type
- false-start position in sequence (detect rhythm-anticipation patterns)
- no-go discrimination accuracy
- distance-axis accuracy (if enabled)

## Non-Goals for MVP
- Multiplayer
- Cloud account system
- AI-generated video
- Perfect pose detection
- Mobile-first design (phone is sensor only, not primary UI)

## Future Features
- Local video clip tagging
- Webcam-based movement detection
- Opponent pose analysis
- Personalized drill recommendations (e.g. auto-weighting cues you fail on)
- Tournament taper mode