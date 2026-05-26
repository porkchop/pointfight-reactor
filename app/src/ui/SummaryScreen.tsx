import { useMemo } from 'react'
import { useSession, getSessionSummary } from '../store/session'
import { antiRhythmSignal, cueBreakdown } from '../engine/drill'
import { CUE_LIBRARY } from '../cues/library'
import type { CueId } from '../engine/types'

export function SummaryScreen() {
  const reps = useSession((s) => s.reps)
  const reset = useSession((s) => s.reset)
  const start = useSession((s) => s.start)
  const persistError = useSession((s) => s.persistError)
  const inputSource = useSession((s) => s.inputSource)
  const config = useSession((s) => s.config)
  const cleared = useSession((s) => s.cleared)

  const summary = useMemo(() => getSessionSummary(reps), [reps])
  const breakdown = useMemo(() => cueBreakdown(reps), [reps])
  const rhythm = useMemo(() => antiRhythmSignal(reps), [reps])

  const breakdownById = useMemo(() => {
    const m = new Map<CueId, (typeof breakdown)[number]>()
    for (const row of breakdown) m.set(row.cueId, row)
    return m
  }, [breakdown])

  return (
    <div className="screen summary">
      <h1>Session summary</h1>

      {persistError && (
        <div className="banner warn">
          Storage unavailable: {persistError}. Session was kept in memory only.
        </div>
      )}

      <p className="summary-meta">
        Input source: <strong>{inputSource}</strong>
        {config.penaltyCounterEnabled && (
          <> · Cleared {cleared} penalty rep{cleared === 1 ? '' : 's'}</>
        )}
      </p>

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

      <div className="rhythm-panel" aria-label="anti-rhythm signal">
        <h2>Rhythm pattern</h2>
        <p>{rhythm.narrative}</p>
      </div>

      <h2>By cue</h2>
      <table className="cue-table">
        <thead>
          <tr>
            <th>Cue</th>
            <th>Reps</th>
            <th>Correct</th>
            <th>FS</th>
            <th>Hes</th>
            <th>Late</th>
            <th>Avg RT</th>
            <th>Best-10 RT</th>
          </tr>
        </thead>
        <tbody>
          {CUE_LIBRARY.map((cue) => {
            const row = breakdownById.get(cue.id)
            if (!row) return null
            return (
              <tr key={cue.id}>
                <td>
                  {cue.label}{' '}
                  <span className="tag">{cue.isGo ? 'go' : 'no-go'}</span>
                </td>
                <td>{row.reps}</td>
                <td>{row.correct}</td>
                <td>{row.falseStarts}</td>
                <td>{row.hesitations}</td>
                <td>{row.lateMisses}</td>
                <td>{row.avgRtMs === null ? '—' : `${row.avgRtMs}`}</td>
                <td>
                  {row.best10AvgRtMs === null ? '—' : `${row.best10AvgRtMs}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => start(config, undefined, inputSource)}
        >
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
