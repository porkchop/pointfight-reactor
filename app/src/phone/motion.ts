/**
 * Phase 2b.3 — accelerometer impulse detection + per-athlete calibration.
 *
 * Pure module: takes pre-shaped {ax, ay, az, t} samples (linear acceleration
 * in m/s², gravity removed by the adapter) and returns `commit` events when
 * the impulse magnitude crosses a calibrated threshold. The DeviceMotionEvent
 * → MotionSample adapter lives in `PhoneApp.tsx`; this module stays
 * browser-free so vitest can exercise it under jsdom without sensor mocks.
 *
 * See `artifacts/decision-memo.md` §"Sub-phase 2b.3" and §B3 for the
 * resolved acceptance contract.
 */

/** Standard gravity in m/s² (CODATA-ish, sufficient for sensor-grade math). */
export const G = 9.80665

/** Default threshold (g) used when a profile has no calibration yet. */
export const DEFAULT_THRESHOLD_G = 1.8

/** Default debounce window between successive commits (ms). */
export const DEFAULT_DEBOUNCE_MS = 300

/** Number of sample swings the calibration UI collects from the athlete. */
export const CALIBRATION_SAMPLE_COUNT = 5

/**
 * Floor (g) above which the phone reports calibration samples. Lower than
 * any normal commit threshold so even soft swings register; chosen well
 * above the at-rest noise floor of common phone accelerometers (~0.05 g).
 */
export const CALIBRATION_FLOOR_G = 0.5

/** Headroom subtracted from the softest captured peak when fitting threshold. */
export const CALIBRATION_EPSILON_G = 0.2

/**
 * Minimum admissible calibrated threshold. Prevents trivial peaks (phone
 * jostled in pocket) from being accepted as a calibration result.
 */
export const CALIBRATION_MIN_THRESHOLD_G = 0.8

export interface MotionSample {
  /** Linear acceleration X (m/s²), gravity removed. */
  ax: number
  /** Linear acceleration Y (m/s²), gravity removed. */
  ay: number
  /** Linear acceleration Z (m/s²), gravity removed. */
  az: number
  /** Sample timestamp (ms, monotonic-ish — Date.now or performance.now). */
  t: number
}

export interface DetectorOptions {
  thresholdG: number
  debounceMs: number
}

export interface CommitEvent {
  type: 'commit'
  /** Timestamp of the sample that crossed the threshold. */
  t: number
  /** Magnitude (in g) at that sample. */
  peakG: number
}

export interface ImpulseDetector {
  /**
   * Feed one sample. Returns a `commit` event iff the magnitude is at or
   * above `thresholdG` and at least `debounceMs` has elapsed since the
   * previous emitted commit; otherwise null.
   */
  push(s: MotionSample): CommitEvent | null
  /** Forget the most recent commit so the next impulse can fire immediately. */
  reset(): void
}

export function magnitudeG(s: {
  ax: number
  ay: number
  az: number
}): number {
  return Math.hypot(s.ax, s.ay, s.az) / G
}

export function createImpulseDetector(opts: DetectorOptions): ImpulseDetector {
  let lastCommitAt: number | null = null
  return {
    push(s) {
      const g = magnitudeG(s)
      if (g < opts.thresholdG) return null
      if (lastCommitAt !== null && s.t - lastCommitAt < opts.debounceMs)
        return null
      lastCommitAt = s.t
      return { type: 'commit', t: s.t, peakG: g }
    },
    reset() {
      lastCommitAt = null
    },
  }
}

/**
 * Resolve the active commit threshold for an athlete given their profile.
 * Single source of truth for the `phoneCalibration?.thresholdG ??
 * DEFAULT_THRESHOLD_G` lookup that the laptop pair + calibrate flows and
 * the phone's runner-init all need.
 */
export function getActiveThresholdG(
  profile:
    | { config: { phoneCalibration?: { thresholdG: number } } }
    | null
    | undefined,
): number {
  return profile?.config.phoneCalibration?.thresholdG ?? DEFAULT_THRESHOLD_G
}

/**
 * Fit a per-athlete commit threshold to a series of captured impulse peaks.
 *
 * Uses the 10th-percentile peak (i.e. the softest of the athlete's
 * intentional swings) minus a small headroom epsilon, so the threshold sits
 * just under what they themselves consider a commit. With the default 5
 * samples, the 10th percentile collapses to the minimum, which is the
 * desired conservative choice — admit even their slowest swing.
 *
 * Returns DEFAULT_THRESHOLD_G when given no samples, and clamps up to
 * CALIBRATION_MIN_THRESHOLD_G to avoid trivially-low thresholds.
 */
export function computeCalibrationThreshold(samplePeaks: number[]): number {
  if (samplePeaks.length === 0) return DEFAULT_THRESHOLD_G
  const sorted = [...samplePeaks].sort((a, b) => a - b)
  const idx = Math.max(0, Math.floor(sorted.length * 0.1))
  const p10 = sorted[idx]
  return Math.max(CALIBRATION_MIN_THRESHOLD_G, p10 - CALIBRATION_EPSILON_G)
}
