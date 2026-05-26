# PointFight Reactor

## Purpose

PointFight Reactor is a local-first browser application for sport karate / point fighting reaction training. It helps the athlete rebuild fast decision commitment by presenting randomized visual cues, opponent video clips, go/no-go situations, and measurable reaction drills.

The app is designed for solo training in a home gym using a laptop, large screen, pads, optional foot pedal, and optional webcam.

## Primary User

A high-level point fighter preparing for competition in 2 weeks. The athlete is already fit and technically skilled. The problem is not conditioning; the problem is hesitation, over-analysis, and delayed commitment under visual uncertainty.

## Core Training Principle

The app trains perception-action coupling:

- See a specific opponent trigger.
- Commit instantly to a preselected response.
- Reset.
- Measure correctness and hesitation.

The app should discourage half-commitments. In scoring, hesitation is worse than a clean wrong decision.

## MVP Features

1. Fullscreen drill mode.
2. Randomized cue presentation.
3. Configurable cue delay.
4. Go/no-go cue logic.
5. Keyboard/foot-pedal response input.
6. Reaction-time measurement.
7. Correct/late/false-start/hesitation scoring.
8. Session history saved locally.
9. CSV/JSON export.
10. Simple drill configuration screen.

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

## Drill Types

### First Beat
A cue appears. Athlete must respond immediately with one committed scoring action.

### Go / No-Go
Some cues are valid openings. Others are baits. Athlete must respond only to valid triggers.

### Counter Entry
Athlete reacts to incoming attacks with a preselected counter.

### Rhythm Break
Athlete attacks when the opponent’s movement rhythm changes.

### Tournament Start
Simulates bow/start/first exchange/reset.

## Scoring

Each rep records:

- cue id
- cue type
- expected response
- athlete response
- reaction time
- correct/incorrect
- false start
- late response
- hesitation

Suggested scoring:

- correct go: +1
- correct no-go: +1
- late go: 0
- false start: -1
- hesitation / half-go: -2

## Non-Goals for MVP

- Multiplayer
- Cloud account system
- AI-generated video
- Perfect pose detection
- Mobile-first design

## Future Features

- Local video clip tagging
- Webcam-based movement detection
- Opponent pose analysis
- Personalized drill recommendations
- Tournament taper mode