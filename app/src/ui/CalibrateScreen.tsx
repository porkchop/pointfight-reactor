import { useCallback, useEffect, useRef, useState } from 'react'
import type { PeerHandle } from '../phone/peer'
import type { PhoneMessage } from '../phone/wire'
import {
  CALIBRATION_FLOOR_G,
  CALIBRATION_SAMPLE_COUNT,
  DEFAULT_DEBOUNCE_MS,
  computeCalibrationThreshold,
  getActiveThresholdG,
} from '../phone/motion'
import type { ProfileRecord } from '../store/profiles'
import { saveProfile } from '../store/profiles'
import type { PhoneCalibration } from '../engine/types'

interface CalibrateScreenProps {
  peer: PeerHandle
  /** Active profile to write the calibrated threshold into. */
  profile: ProfileRecord
  /** Called with the freshly-saved profile when calibration completes. */
  onSaved: (next: ProfileRecord) => void
}

export type CalibrateStatus =
  | 'idle'
  | 'collecting'
  | 'done'
  | 'aborted'

export function CalibrateScreen({
  peer,
  profile,
  onSaved,
}: CalibrateScreenProps) {
  const [status, setStatus] = useState<CalibrateStatus>('idle')
  const [peaks, setPeaks] = useState<number[]>([])
  const [savedThreshold, setSavedThreshold] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Authoritative store for collected peaks. setPeaks is a render-state
  // mirror; React StrictMode double-invokes the updater function, so any
  // side effect derived from the post-push count has to live outside the
  // updater. We compare against `peaksRef.current` (immune to double-
  // invocation because the message handler itself runs once per event).
  const peaksRef = useRef<number[]>([])
  // Pin the previously calibrated threshold so the "current" readout
  // doesn't flicker between the saved value and the new one mid-save.
  const [initialThreshold] = useState<number | null>(
    profile.config.phoneCalibration?.thresholdG ?? null,
  )

  const finishCalibration = useCallback(
    async (captured: number[]): Promise<void> => {
      const thresholdG = computeCalibrationThreshold(captured)
      const calibration: PhoneCalibration = {
        thresholdG,
        calibratedAt: Date.now(),
      }
      const next: ProfileRecord = {
        ...profile,
        config: { ...profile.config, phoneCalibration: calibration },
      }
      try {
        await saveProfile(next)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        setStatus('aborted')
        return
      }
      try {
        peer.send({
          type: 'config',
          thresholdG,
          debounceMs: DEFAULT_DEBOUNCE_MS,
          mode: 'armed',
        })
      } catch (e) {
        // Save succeeded; the phone just didn't get the new threshold
        // because the channel dropped. Surface it but keep the saved state.
        setErr(e instanceof Error ? e.message : String(e))
      }
      setSavedThreshold(thresholdG)
      setStatus('done')
      onSaved(next)
    },
    [peer, profile, onSaved],
  )

  useEffect(() => {
    if (status !== 'collecting') return
    const off = peer.onMessage((m: PhoneMessage) => {
      if (m.type !== 'sample') return
      if (peaksRef.current.length >= CALIBRATION_SAMPLE_COUNT) return
      const next = [...peaksRef.current, m.peakG]
      peaksRef.current = next
      setPeaks(next)
      if (next.length === CALIBRATION_SAMPLE_COUNT) {
        void finishCalibration(next)
      }
    })
    return off
  }, [peer, status, finishCalibration])

  async function startCalibration(): Promise<void> {
    setErr(null)
    peaksRef.current = []
    setPeaks([])
    setSavedThreshold(null)
    setStatus('collecting')
    try {
      peer.send({
        type: 'config',
        thresholdG: CALIBRATION_FLOOR_G,
        debounceMs: DEFAULT_DEBOUNCE_MS,
        mode: 'calibrating',
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setStatus('aborted')
    }
  }

  function reset(): void {
    setStatus('idle')
    peaksRef.current = []
    setPeaks([])
    setErr(null)
  }

  const currentThreshold =
    savedThreshold ?? initialThreshold ?? getActiveThresholdG(null)
  const remaining = Math.max(0, CALIBRATION_SAMPLE_COUNT - peaks.length)

  return (
    <section
      className="settings-section"
      data-testid="calibrate-panel"
      aria-label="motion calibration"
    >
      <h2>Calibrate motion threshold</h2>
      <p className="hint">
        Throw {CALIBRATION_SAMPLE_COUNT} of your softest deliberate
        commit-strength swings — the laptop fits a per-athlete threshold
        from the captured peaks.
      </p>
      <p>
        Current threshold:{' '}
        <strong data-testid="calibrate-current">
          {currentThreshold.toFixed(2)} g
        </strong>
        {initialThreshold === null && (
          <em className="hint"> (default — not yet calibrated)</em>
        )}
      </p>

      {status === 'idle' && (
        <button
          type="button"
          className="primary"
          onClick={() => void startCalibration()}
          aria-label="start calibration"
        >
          Start calibration
        </button>
      )}

      {status === 'collecting' && (
        <div data-testid="calibrate-progress">
          <p>
            Captured {peaks.length} / {CALIBRATION_SAMPLE_COUNT}. Swings
            remaining: <strong>{remaining}</strong>.
          </p>
          {peaks.length > 0 && (
            <ul className="hint">
              {peaks.map((g, i) => (
                <li key={i}>
                  Sample {i + 1}: {g.toFixed(2)} g
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="link"
            onClick={reset}
            aria-label="cancel calibration"
          >
            Cancel
          </button>
        </div>
      )}

      {status === 'done' && savedThreshold !== null && (
        <div data-testid="calibrate-done">
          <p>
            Saved threshold:{' '}
            <strong>{savedThreshold.toFixed(2)} g</strong>
          </p>
          <button
            type="button"
            className="link"
            onClick={reset}
            aria-label="recalibrate"
          >
            Re-run calibration
          </button>
        </div>
      )}

      {err && (
        <div className="banner warn" role="alert" data-testid="calibrate-error">
          {err}
        </div>
      )}
    </section>
  )
}
