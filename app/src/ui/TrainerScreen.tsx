import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '../store/session'
import { pendingPenalties } from '../engine/drill'
import type { RepResult } from '../engine/types'
import { CueStage } from './CueStage'
import { RestScreen } from './RestScreen'
import { startDistanceTone, stopDistanceTone } from '../audio/distanceTone'
import { usePhonePeer } from '../store/phone-peer'

const FEEDBACK_HOLD_MS = 1000

interface TrainerScreenProps {
  commitKeyCode: string
  commitKeyLabel: string
}

export function TrainerScreen({
  commitKeyCode,
  commitKeyLabel,
}: TrainerScreenProps) {
  const phase = useSession((s) => s.phase)
  const current = useSession((s) => s.current)
  const feedback = useSession((s) => s.feedback)
  const config = useSession((s) => s.config)
  const reps = useSession((s) => s.reps)
  const roundIndex = useSession((s) => s.roundIndex)
  const workEndAt = useSession((s) => s.workEndAt)
  const cleared = useSession((s) => s.cleared)
  const inputSource = useSession((s) => s.inputSource)
  const revealCue = useSession((s) => s.revealCue)
  const recordPress = useSession((s) => s.recordPress)
  const finishWindow = useSession((s) => s.finishWindow)
  const acknowledgeFeedback = useSession((s) => s.acknowledgeFeedback)
  const stop = useSession((s) => s.stop)
  const phoneStatus = usePhonePeer((s) => s.status)

  // phaseRef keeps the commit dispatcher stable across phase transitions —
  // otherwise the phone-peer onCommit subscription would re-bind on every
  // rep, churning the slice's handler set. Keyboard's listener doesn't need
  // the ref but reads through it for symmetry.
  const phaseRef = useRef(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const dispatchCommit = useCallback(
    (at: number) => {
      const p = phaseRef.current
      if (p === 'waiting' || p === 'showing') {
        recordPress(at)
      } else if (p === 'feedback') {
        acknowledgeFeedback()
      }
    },
    [recordPress, acknowledgeFeedback],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === commitKeyCode) {
        e.preventDefault()
        dispatchCommit(performance.now())
      } else if (e.key === 'Escape') {
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commitKeyCode, dispatchCommit, stop])

  // Phase 2b.4 — phone-as-input. Phone commits route through the same
  // dispatchCommit the keyboard handler uses so the drill engine's logic
  // (waiting → showing → feedback, hesitation/late thresholds, false-start
  // classification) applies identically across input sources.
  useEffect(() => {
    if (inputSource !== 'phone') return
    return usePhonePeer.getState().onCommit((c) => dispatchCommit(c.receivedAt))
  }, [inputSource, dispatchCommit])

  useEffect(() => {
    if (phase !== 'waiting' || !current || current.cueShownAt !== null) return
    const timer = window.setTimeout(revealCue, current.preCueDelayMs)
    return () => window.clearTimeout(timer)
  }, [phase, current, revealCue])

  useEffect(() => {
    if (phase !== 'showing' || !current?.cueShownAt) return
    const timer = window.setTimeout(finishWindow, config.responseWindowMs)
    return () => window.clearTimeout(timer)
  }, [phase, current, config.responseWindowMs, finishWindow])

  useEffect(() => {
    if (phase !== 'feedback') return
    const timer = window.setTimeout(acknowledgeFeedback, FEEDBACK_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [phase, acknowledgeFeedback])

  useEffect(() => {
    if (!config.audioToneEnabled) return
    if (phase === 'showing' && current?.distance) {
      startDistanceTone(current.distance)
      return () => stopDistanceTone()
    }
  }, [phase, current?.distance, config.audioToneEnabled])

  const [now, setNow] = useState<number>(() => performance.now())
  useEffect(() => {
    if (workEndAt === null) return
    const interval = window.setInterval(() => setNow(performance.now()), 250)
    return () => window.clearInterval(interval)
  }, [workEndAt])
  const workSecondsRemaining =
    workEndAt === null ? null : Math.max(0, Math.ceil((workEndAt - now) / 1000))

  if (phase === 'rest') {
    return <RestScreen />
  }

  const repsDone = reps.length
  const penalties = config.penaltyCounterEnabled
    ? pendingPenalties(
        reps,
        config.perFalseStartPenalty,
        config.perHesitationPenalty,
        cleared,
      )
    : 0

  const phoneDropped =
    inputSource === 'phone' && phoneStatus !== 'connected'

  return (
    <div
      className={`screen trainer trainer-${
        phase === 'feedback' && feedback ? feedback.rep.result : phase
      }`}
    >
      {phoneDropped && (
        <div
          className="banner warn"
          role="alert"
          data-testid="phone-dropped"
        >
          Phone disconnected ({phoneStatus}) — reconnect to continue.
        </div>
      )}
      <header className="hud">
        <span>
          Round {roundIndex + 1}/{config.rounds}
        </span>
        <span>Rep {repsDone + (phase === 'ended' ? 0 : 1)}</span>
        {workSecondsRemaining !== null && (
          <WorkClock totalSeconds={workSecondsRemaining} />
        )}
        {config.penaltyCounterEnabled && (
          <span className="hud-penalties" aria-label="pending penalty reps">
            +{penalties}
          </span>
        )}
        <button
          type="button"
          className="link"
          onClick={stop}
          aria-label="Stop drill"
        >
          Stop (Esc)
        </button>
      </header>

      <main className="stage">
        {phase === 'waiting' && (
          <div className="ready">
            <span className="ready-label">READY</span>
            <span className="motion-pulse" aria-hidden="true" />
          </div>
        )}

        {phase === 'showing' && current && (
          <CueStage
            cue={current.cue}
            distance={current.distance}
            textOverlayEnabled={config.textOverlayEnabled}
            keyHint={commitKeyLabel}
          />
        )}

        {phase === 'feedback' && feedback && (
          <div className="feedback">
            <span className="feedback-label">
              {feedbackLabel(feedback.rep.result)}
            </span>
            {feedback.rep.reactionMs !== null && (
              <span className="feedback-sub">{feedback.rep.reactionMs} ms</span>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function WorkClock({ totalSeconds }: { totalSeconds: number }) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return (
    <span className="hud-clock" aria-label="work time remaining">
      {m}:{s.toString().padStart(2, '0')}
    </span>
  )
}

function feedbackLabel(result: RepResult): string {
  switch (result) {
    case 'correct_go':
      return 'GO ✓'
    case 'correct_no_go':
      return 'HOLD ✓'
    case 'late':
      return 'LATE'
    case 'false_start':
      return 'FALSE START'
    case 'hesitation':
      return 'HESITATION'
  }
}
