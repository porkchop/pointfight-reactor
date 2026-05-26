import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_FLOOR_G,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_THRESHOLD_G,
  G,
  type MotionSample,
} from './motion'
import { createMotionRunner } from './motion-runner'

function impulse(t: number, peakG: number): MotionSample {
  return { ax: peakG * G, ay: 0, az: 0, t }
}

describe('createMotionRunner', () => {
  it('emits commit messages in armed mode when impulses cross the threshold', () => {
    const runner = createMotionRunner({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      mode: 'armed',
    })
    const msg = runner.push(impulse(100, 2.5))
    expect(msg).toEqual({ type: 'commit', t: 100 })
  })

  it('ignores below-threshold motion in armed mode', () => {
    const runner = createMotionRunner({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      mode: 'armed',
    })
    expect(runner.push(impulse(100, 1.0))).toBeNull()
  })

  it('emits sample messages in calibrating mode with the captured peakG', () => {
    const runner = createMotionRunner({
      thresholdG: CALIBRATION_FLOOR_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      mode: 'calibrating',
    })
    const msg = runner.push(impulse(50, 1.4))
    expect(msg).toMatchObject({ type: 'sample', t: 50 })
    if (msg?.type === 'sample') {
      expect(msg.peakG).toBeCloseTo(1.4, 6)
    }
  })

  it('setConfig switches mode and resets the debounce', () => {
    const runner = createMotionRunner({
      thresholdG: CALIBRATION_FLOOR_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      mode: 'calibrating',
    })
    // First impulse fires while calibrating.
    expect(runner.push(impulse(0, 1.0))?.type).toBe('sample')
    // Switch to armed at threshold 1.8; reset clears debounce so an
    // immediate above-threshold impulse fires as a commit.
    runner.setConfig({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      mode: 'armed',
    })
    const fired = runner.push(impulse(50, 2.5))
    expect(fired).toEqual({ type: 'commit', t: 50 })
  })

  it('exposes its current mode for UI status display', () => {
    const runner = createMotionRunner({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      mode: 'armed',
    })
    expect(runner.mode).toBe('armed')
    runner.setConfig({
      thresholdG: CALIBRATION_FLOOR_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      mode: 'calibrating',
    })
    expect(runner.mode).toBe('calibrating')
  })
})
