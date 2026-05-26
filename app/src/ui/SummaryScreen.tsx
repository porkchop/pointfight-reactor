import { useMemo } from 'react'
import { useSession, getSessionSummary } from '../store/session'
import { CUE_LIBRARY } from '../cues/library'
import type { CueId } from '../engine/types'

export function SummaryScreen() {
  const reps = useSession((s) => s.reps)
  const reset = useSession((s) => s.reset)
  const start = useSession((s) => s.start)
  const persistError = useSession((s) => s.persistError)

  const summary = useMemo(() => getSessionSummary(reps), [reps])

  const byCue = useMemo(() => {
    const map = new Map<CueId, { reps: number; correct: number }>()
    for (const cue of CUE_LIBRARY) {
      map.set(cue.id, { reps: 0, correct: 0 })
    }
    for (const r of reps) {
      const row = map.get(r.cueId)
      if (!row) continue
      row.reps++
      if (r.result === 'correct_go' || r.result === 'correct_no_go') {
        row.correct++
      }
    }
    return map
  }, [reps])

  return (
    <div className="screen summary">
      <h1>Session summary</h1>

      {persistError && (
        <div className="banner warn">
          Storage unavailable: {persistError}. Session was kept in memory only.
        </div>
      )}

      <div className="stats">
        <Stat label="Reps" value={summary.reps} />
        <Stat label="Score" value={summary.score} />
        <Stat label="Correct" value={summary.correct} />
        <Stat label="False starts" value={summary.falseStarts} />
        <Stat label="Hesitations" value={summary.hesitations} />
        <Stat label="Late misses" value={summary.lateMisses} />
        <Stat
          label="Avg reaction"
          value={
            summary.avgReactionMs === null
              ? '—'
              : `${summary.avgReactionMs} ms`
          }
        />
      </div>

      <h2>By cue</h2>
      <table className="cue-table">
        <thead>
          <tr>
            <th>Cue</th>
            <th>Reps</th>
            <th>Correct</th>
          </tr>
        </thead>
        <tbody>
          {CUE_LIBRARY.map((cue) => {
            const row = byCue.get(cue.id) ?? { reps: 0, correct: 0 }
            return (
              <tr key={cue.id}>
                <td>
                  {cue.label}{' '}
                  <span className="tag">{cue.isGo ? 'go' : 'no-go'}</span>
                </td>
                <td>{row.reps}</td>
                <td>{row.correct}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="actions">
        <button type="button" className="primary" onClick={() => start()}>
          Start another session
        </button>
        <button type="button" className="link" onClick={() => reset()}>
          Back to start
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}
