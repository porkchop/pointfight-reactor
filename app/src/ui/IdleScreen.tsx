import { useEffect, useState } from 'react'
import { listRecentSessions } from '../store/db'
import { useSession } from '../store/session'
import type { SessionRecord } from '../engine/types'

export function IdleScreen() {
  const start = useSession((s) => s.start)
  const [recent, setRecent] = useState<SessionRecord[]>([])

  useEffect(() => {
    void listRecentSessions(5).then(setRecent)
  }, [])

  return (
    <div className="screen idle">
      <h1>PointFight Reactor</h1>
      <p className="subtitle">First-beat go / no-go drill</p>

      <button
        className="primary"
        type="button"
        onClick={() => {
          void requestFullscreen()
          start()
        }}
        autoFocus
      >
        Start drill
      </button>
      <p className="hint">
        Press <kbd>Space</kbd> to commit. Press <kbd>Esc</kbd> to stop.
      </p>

      {recent.length > 0 && (
        <div className="recent">
          <h2>Recent sessions</h2>
          <ul>
            {recent.map((s) => (
              <li key={s.id}>
                <span className="when">
                  {new Date(s.startedAt).toLocaleString()}
                </span>
                <span className="meta">
                  {s.repCount} reps · score {s.summary.score}
                  {s.summary.avgReactionMs !== null &&
                    ` · ${s.summary.avgReactionMs}ms avg`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

async function requestFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) return
    await document.documentElement.requestFullscreen()
  } catch {
    /* user can run windowed; no-op */
  }
}
