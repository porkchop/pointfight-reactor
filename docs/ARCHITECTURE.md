# Architecture

## Stack

- Vite
- React
- TypeScript
- Zustand for state
- Dexie/IndexedDB for local persistence
- Web Audio API for cue sounds
- HTML5 video for opponent clips
- Optional webcam pose detection in later phase

## Main Modules

### Drill Engine

Responsible for:

- selecting next cue
- applying random delay
- starting cue timer
- accepting response
- classifying result
- producing rep record

### Cue Library

Stores:

- text cues
- image cues
- video cues
- cue metadata
- correct responses
- go/no-go classification

### Session Store

Stores:

- drill config
- rep results
- session summaries
- athlete notes

### Input Layer

Supports:

- keyboard
- foot pedal as keyboard
- optional webcam movement detection

### Analytics

Computes:

- average reaction time
- best 10-rep average
- cue-specific accuracy
- hesitation rate
- false-start rate
- no-go discipline

## Design Constraints

- Must work offline.
- Must work fullscreen on a gym screen.
- Must be fast and low-latency.
- Must not require login.
- Must preserve all user data locally.