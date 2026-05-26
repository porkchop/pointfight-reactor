import {
  createImpulseDetector,
  type MotionSample,
} from './motion'
import type { PhoneMessage } from './wire'

export type RunnerMode = 'armed' | 'calibrating'

export interface MotionRunnerConfig {
  thresholdG: number
  debounceMs: number
  mode: RunnerMode
}

export interface MotionRunner {
  /**
   * Feed a single motion sample. Returns the message that should be sent
   * over the DataChannel (commit when armed, sample when calibrating), or
   * null if the sample did not cross the threshold or fell inside the
   * debounce window.
   */
  push(s: MotionSample): PhoneMessage | null
  /**
   * Replace the active configuration. Resets the internal debounce state so
   * an immediate above-threshold impulse can fire after a mode switch — the
   * laptop expects to see commits right after `mode: 'armed'` is sent.
   */
  setConfig(c: MotionRunnerConfig): void
  readonly mode: RunnerMode
  readonly config: MotionRunnerConfig
}

export function createMotionRunner(
  initial: MotionRunnerConfig,
): MotionRunner {
  let cfg = initial
  let detector = createImpulseDetector({
    thresholdG: cfg.thresholdG,
    debounceMs: cfg.debounceMs,
  })
  return {
    push(s) {
      const evt = detector.push(s)
      if (!evt) return null
      if (cfg.mode === 'calibrating') {
        return { type: 'sample', t: evt.t, peakG: evt.peakG }
      }
      return { type: 'commit', t: evt.t }
    },
    setConfig(c) {
      cfg = c
      detector = createImpulseDetector({
        thresholdG: c.thresholdG,
        debounceMs: c.debounceMs,
      })
    },
    get mode() {
      return cfg.mode
    },
    get config() {
      // Return a copy so callers cannot mutate the internal cfg object
      // and silently desync the detector from its reported configuration.
      return { ...cfg }
    },
  }
}
