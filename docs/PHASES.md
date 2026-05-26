# Phase Plan

## Phase 1: Local MVP Cue Trainer

Build a React/TypeScript app with fullscreen cue presentation, randomized delays, keyboard input, scoring, and local session history.

Acceptance criteria:

- User can start a drill.
- App presents randomized go/no-go cues.
- User can respond with keyboard.
- App records reaction time.
- App displays rep result immediately.
- App summarizes the session.
- Session persists locally.

## Phase 2: Drill Configuration

Add configurable drill profiles.

Acceptance criteria:

- User can create/edit drill profiles.
- User can choose cue types.
- User can set delay ranges.
- User can set response windows.
- User can set scoring rules.

## Phase 3: Video Opponent Mode

Add local video clip import and manual cue-time tagging.

Acceptance criteria:

- User can import local clips.
- User can tag cue type and cue timestamp.
- App can randomly play clips.
- Reaction timer starts from cue timestamp.
- Results are stored by clip and cue type.

## Phase 4: Foot Pedal / External Input Support

Improve physical usability in gym setting.

Acceptance criteria:

- Keyboard mappings are configurable.
- Foot pedal works as keyboard input.
- App supports fullscreen kiosk-like mode.
- Large visual feedback works from training distance.

## Phase 5: Webcam Pose Detection Prototype

Add optional webcam-based response detection.

Acceptance criteria:

- User can enable webcam mode.
- App detects first meaningful movement.
- Manual input remains available.
- App compares manual vs detected reaction time.
- Feature is marked experimental.

## Phase 6: Analytics and Competition Mode

Add tournament-prep reporting.

Acceptance criteria:

- App shows reaction time by cue type.
- App shows false-start rate.
- App shows hesitation rate.
- App shows best 10-rep average.
- App has a low-volume high-speed taper mode.