import { useEffect, useState } from 'react'
import { useSession } from '../store/session'
import { pendingPenalties } from '../engine/drill'

export function RestScreen() {
  const restEndAt = useSession((s) => s.restEndAt)
  const config = useSession((s) => s.config)
  const reps = useSession((s) => s.reps)
  const cleared = useSession((s) => s.cleared)
  const roundIndex = useSession((s) => s.roundIndex)
  const clearPenalty = useSession((s) => s.clearPenalty)
  const nextRound = useSession((s) => s.nextRound)
  const stop = useSession((s) => s.stop)

  const [secondsLeft, setSecondsLeft] = useState(() =>
    restEndAt === null
      ? 0
      : Math.max(0, Math.ceil((restEndAt - performance.now()) / 1000)),
  )

  useEffect(() => {
    if (restEndAt === null) return
    const interval = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((restEndAt - performance.now()) / 1000))
      setSecondsLeft(s)
      if (s === 0) {
        window.clearInterval(interval)
        nextRound()
      }
    }, 250)
    return () => window.clearInterval(interval)
  }, [restEndAt, nextRound])

  const penalties = config.penaltyCounterEnabled
    ? pendingPenalties(
        reps,
        config.perFalseStartPenalty,
        config.perHesitationPenalty,
        cleared,
      )
    : 0

  const m = Math.floor(secondsLeft / 60)
  const s = secondsLeft % 60

  return (
    <div className="screen rest">
      <header className="hud">
        <span>
          Round {roundIndex + 1}/{config.rounds} complete
        </span>
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
        <h2>REST</h2>
        <div className="rest-clock" aria-label="rest remaining">
          {m}:{s.toString().padStart(2, '0')}
        </div>

        {config.penaltyCounterEnabled && (
          <div className="penalty-panel" aria-label="penalty clear list">
            <p className="penalty-count">
              {penalties} penalty rep{penalties === 1 ? '' : 's'} to clear
            </p>
            {penalties > 0 ? (
              <button
                type="button"
                className="primary"
                onClick={() => clearPenalty()}
              >
                Clear one
              </button>
            ) : (
              <p className="muted">All clear</p>
            )}
          </div>
        )}

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => nextRound()}
          >
            Skip rest → next round
          </button>
        </div>
      </main>
    </div>
  )
}
