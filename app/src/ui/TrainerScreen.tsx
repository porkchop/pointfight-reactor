import { useEffect } from 'react'
import { useSession } from '../store/session'
import type { RepResult } from '../engine/types'

const FEEDBACK_HOLD_MS = 1000

export function TrainerScreen() {
  const phase = useSession((s) => s.phase)
  const current = useSession((s) => s.current)
  const feedback = useSession((s) => s.feedback)
  const config = useSession((s) => s.config)
  const reps = useSession((s) => s.reps)
  const revealCue = useSession((s) => s.revealCue)
  const recordPress = useSession((s) => s.recordPress)
  const finishWindow = useSession((s) => s.finishWindow)
  const acknowledgeFeedback = useSession((s) => s.acknowledgeFeedback)
  const stop = useSession((s) => s.stop)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'waiting' || phase === 'showing') {
          recordPress(performance.now())
        } else if (phase === 'feedback') {
          acknowledgeFeedback()
        }
      } else if (e.key === 'Escape') {
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, recordPress, acknowledgeFeedback, stop])

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

  const repsDone = reps.length

  return (
    <div
      className={`screen trainer trainer-${
        phase === 'feedback' && feedback ? feedback.rep.result : phase
      }`}
    >
      <header className="hud">
        <span>Rep {repsDone + (phase === 'ended' ? 0 : 1)}</span>
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
            <span className="dot" />
          </div>
        )}

        {phase === 'showing' && current && (
          <div className="cue">
            <span className="cue-label">{current.cue.label}</span>
            <span className="cue-sub">
              {current.cue.isGo ? 'Commit now' : 'Hold position'}
            </span>
          </div>
        )}

        {phase === 'feedback' && feedback && (
          <div className="feedback">
            <span className="feedback-label">
              {feedbackLabel(feedback.rep.result)}
            </span>
            {feedback.rep.reactionMs !== null && (
              <span className="feedback-sub">
                {Math.round(feedback.rep.reactionMs)} ms
              </span>
            )}
          </div>
        )}
      </main>
    </div>
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
