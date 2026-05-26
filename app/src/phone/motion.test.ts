import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_EPSILON_G,
  CALIBRATION_MIN_THRESHOLD_G,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_THRESHOLD_G,
  G,
  computeCalibrationThreshold,
  createImpulseDetector,
  getActiveThresholdG,
  magnitudeG,
  type MotionSample,
} from './motion'

function zeroStream(count: number, dt: number, startT = 0): MotionSample[] {
  const out: MotionSample[] = []
  for (let i = 0; i < count; i++) {
    out.push({ ax: 0, ay: 0, az: 0, t: startT + i * dt })
  }
  return out
}

function impulseAt(t: number, peakG: number): MotionSample {
  // Linear-acceleration sample whose magnitude is exactly `peakG` g, oriented
  // along +x for determinism. Detector only inspects the magnitude.
  return { ax: peakG * G, ay: 0, az: 0, t }
}

describe('magnitudeG', () => {
  it('is 0 for a zero vector', () => {
    expect(magnitudeG({ ax: 0, ay: 0, az: 0 })).toBe(0)
  })

  it('is 1 for a single-axis vector of magnitude G m/s^2', () => {
    expect(magnitudeG({ ax: 0, ay: 0, az: G })).toBeCloseTo(1, 6)
  })

  it('is the Euclidean norm divided by G', () => {
    // 3-4-5 triangle: hypot 5 * G/5 = 1 g
    expect(magnitudeG({ ax: 3 * G * 0.2, ay: 4 * G * 0.2, az: 0 })).toBeCloseTo(
      1,
      6,
    )
  })
})

describe('createImpulseDetector', () => {
  it('emits zero commits across a still 60-second baseline', () => {
    const detector = createImpulseDetector({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    })
    // 60 s of zero-motion samples at 60 Hz.
    const samples = zeroStream(60 * 60, 1000 / 60)
    const commits = samples.map((s) => detector.push(s)).filter(Boolean)
    expect(commits).toHaveLength(0)
  })

  it('emits exactly one commit for a single above-threshold impulse', () => {
    const detector = createImpulseDetector({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    })
    // 200 ms of stillness, then a 2 g impulse, then 200 ms of stillness.
    const out: ReturnType<typeof detector.push>[] = []
    for (const s of zeroStream(12, 1000 / 60, 0)) out.push(detector.push(s))
    out.push(detector.push(impulseAt(250, 2.0)))
    for (const s of zeroStream(12, 1000 / 60, 260)) out.push(detector.push(s))
    const commits = out.filter((e) => e?.type === 'commit')
    expect(commits).toHaveLength(1)
    expect(commits[0]?.t).toBe(250)
    expect(commits[0]?.peakG).toBeCloseTo(2.0, 6)
  })

  it('emits exactly five commits for five well-separated impulses', () => {
    const detector = createImpulseDetector({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    })
    // Impulses 800 ms apart — well clear of the 300 ms debounce.
    const ts = [0, 800, 1600, 2400, 3200]
    const commits = ts
      .map((t) => detector.push(impulseAt(t, 2.5)))
      .filter((e) => e?.type === 'commit')
    expect(commits).toHaveLength(5)
    expect(commits.map((c) => c?.t)).toEqual(ts)
  })

  it('debounces a double-tap within the debounce window to one commit', () => {
    const detector = createImpulseDetector({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    })
    const first = detector.push(impulseAt(100, 2.5))
    const second = detector.push(impulseAt(250, 2.5)) // 150 ms later
    expect(first?.type).toBe('commit')
    expect(second).toBeNull()
  })

  it('admits an impulse at exactly the debounce-window boundary', () => {
    // Pins the implementation's strict-less-than debounce: a sample whose
    // delta from the previous commit equals `debounceMs` is admitted, not
    // suppressed. Matters when the laptop and phone sit on slightly
    // different clock domains and round to the same millisecond.
    const detector = createImpulseDetector({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    })
    expect(detector.push(impulseAt(100, 2.5))?.type).toBe('commit')
    expect(detector.push(impulseAt(100 + DEFAULT_DEBOUNCE_MS, 2.5))?.type).toBe(
      'commit',
    )
  })

  it('admits a second commit once the debounce window has elapsed', () => {
    const detector = createImpulseDetector({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    })
    const first = detector.push(impulseAt(100, 2.5))
    const second = detector.push(impulseAt(500, 2.5)) // 400 ms later
    expect(first?.type).toBe('commit')
    expect(second?.type).toBe('commit')
  })

  it('ignores below-threshold samples even past the debounce window', () => {
    const detector = createImpulseDetector({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    })
    expect(detector.push(impulseAt(100, 1.0))).toBeNull()
    expect(detector.push(impulseAt(500, 1.0))).toBeNull()
  })

  it('reset() clears the last-commit timestamp so the next impulse fires', () => {
    const detector = createImpulseDetector({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    })
    expect(detector.push(impulseAt(100, 2.5))?.type).toBe('commit')
    // Within debounce, no commit.
    expect(detector.push(impulseAt(250, 2.5))).toBeNull()
    detector.reset()
    expect(detector.push(impulseAt(260, 2.5))?.type).toBe('commit')
  })
})

describe('computeCalibrationThreshold', () => {
  it('returns DEFAULT_THRESHOLD_G when given no samples', () => {
    expect(computeCalibrationThreshold([])).toBe(DEFAULT_THRESHOLD_G)
  })

  it('returns p10 of the sample peaks minus the epsilon headroom', () => {
    // Five samples — softest is 1.6 g; p10 with 5 values is the smallest.
    const peaks = [2.0, 1.8, 1.6, 1.9, 2.1]
    expect(computeCalibrationThreshold(peaks)).toBeCloseTo(
      1.6 - CALIBRATION_EPSILON_G,
      6,
    )
  })

  it('returns a different threshold when re-run with new samples', () => {
    const first = computeCalibrationThreshold([2.5, 2.6, 2.4, 2.5, 2.5])
    const second = computeCalibrationThreshold([1.2, 1.3, 1.4, 1.3, 1.2])
    expect(first).not.toBeCloseTo(second, 3)
  })

  it('clamps to the minimum threshold floor when the user swings softly', () => {
    // A 0.6 g softest peak would suggest a 0.4 g threshold, which is below
    // the floor — clamp up.
    const peaks = [0.6, 0.7, 0.8, 0.6, 0.7]
    expect(computeCalibrationThreshold(peaks)).toBe(
      CALIBRATION_MIN_THRESHOLD_G,
    )
  })

  it('uses the 10th-percentile peak (not the minimum) for larger samples', () => {
    // With 11 samples, p10 should sit at index 1 (Math.floor(11 * 0.1)) —
    // the second-smallest, not the smallest. This pins the percentile
    // behavior so a future refactor to `Math.min(...peaks)` would fail.
    const peaks = [1.0, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5]
    const result = computeCalibrationThreshold(peaks)
    expect(result).toBeCloseTo(1.6 - CALIBRATION_EPSILON_G, 6)
    expect(result).not.toBeCloseTo(1.0 - CALIBRATION_EPSILON_G, 6)
  })
})

describe('getActiveThresholdG', () => {
  it('returns the calibrated threshold when present', () => {
    expect(
      getActiveThresholdG({
        config: { phoneCalibration: { thresholdG: 1.42 } },
      }),
    ).toBe(1.42)
  })

  it('falls back to DEFAULT_THRESHOLD_G when no calibration exists', () => {
    expect(getActiveThresholdG({ config: {} })).toBe(DEFAULT_THRESHOLD_G)
  })

  it('falls back to DEFAULT_THRESHOLD_G when the profile is null/undefined', () => {
    expect(getActiveThresholdG(null)).toBe(DEFAULT_THRESHOLD_G)
    expect(getActiveThresholdG(undefined)).toBe(DEFAULT_THRESHOLD_G)
  })
})
