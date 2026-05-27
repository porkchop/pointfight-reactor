import { useMemo } from 'react'
import { useSession, getSessionSummary } from '../store/session'
import { useClipRunner } from '../clipmode/runner'
import { antiRhythmSignal, cueBreakdown, summarize } from '../engine/drill'
import { CUE_LIBRARY } from '../cues/library'
import type { CueId, RepRecord } from '../engine/types'

interface SummaryScreenProps {
  /** Phase 6.3 — when 'clip', reads from useClipRunner and shows a per-clip
   *  breakdown. Defaults to 'live' for back-compat with all prior call sites. */
  mode?: 'live' | 'clip'
  /** Phase 6.3 — clip-mode resets through here so App.tsx can route back to Idle. */
  onClose?: () => void
}

export function SummaryScreen({ mode = 'live', onClose }: SummaryScreenProps = {}) {
  const liveReps = useSession((s) => s.reps)
  const liveReset = useSession((s) => s.reset)
  const liveStart = useSession((s) => s.start)
  const livePersistError = useSession((s) => s.persistError)
  const liveInputSource = useSession((s) => s.inputSource)
  const liveConfig = useSession((s) => s.config)
  const cleared = useSession((s) => s.cleared)

  const clipReps = useClipRunner((s) => s.reps)
  const clipInputSource = useClipRunner((s) => s.inputSource)
  const clipConfig = useClipRunner((s) => s.config)
  const clipPool = useClipRunner((s) => s.pool)
  const clipPersistError = useClipRunner((s) => s.persistError)

  const isClip = mode === 'clip'
  const reps: RepRecord[] = isClip ? clipReps : liveReps
  const inputSource = isClip ? clipInputSource : liveInputSource
  const config = isClip ? clipConfig : liveConfig
  const persistError = isClip ? clipPersistError : livePersistError

  const summary = useMemo(
    () => (isClip ? summarize(reps) : getSessionSummary(reps)),
    [reps, isClip],
  )
  const breakdown = useMemo(() => cueBreakdown(reps), [reps])
  const rhythm = useMemo(() => antiRhythmSignal(reps), [reps])

  // Per-clip cueBreakdown rows, keyed by clip-id, for clip-mode sessions only.
  const perClipBreakdown = useMemo(() => {
    if (!isClip) return []
    const byClipId = new Map<string, RepRecord[]>()
    for (const r of reps) {
      if (!r.clipId) continue
      const list = byClipId.get(r.clipId) ?? []
      list.push(r)
      byClipId.set(r.clipId, list)
    }
    return Array.from(byClipId.entries()).map(([clipId, list]) => {
      const clip = clipPool.find((c) => c.id === clipId)
      return {
        clipId,
        clipName: clip?.name ?? clipId,
        rows: cueBreakdown(list),
      }
    })
  }, [reps, isClip, clipPool])

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

      {isClip && perClipBreakdown.length > 0 && (
        <>
          <h2>By clip</h2>
          {perClipBreakdown.map(({ clipId, clipName, rows }) => (
            <table
              key={clipId}
              className="cue-table per-clip"
              data-testid="per-clip-breakdown"
              data-clip-id={clipId}
            >
              <caption>{clipName}</caption>
              <thead>
                <tr>
                  <th>Cue</th>
                  <th>Reps</th>
                  <th>Correct</th>
                  <th>FS</th>
                  <th>Hes</th>
                  <th>Late</th>
                  <th>Avg RT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const cue = CUE_LIBRARY.find((c) => c.id === row.cueId)
                  return (
                    <tr key={row.cueId}>
                      <td>{cue?.label ?? row.cueId}</td>
                      <td>{row.reps}</td>
                      <td>{row.correct}</td>
                      <td>{row.falseStarts}</td>
                      <td>{row.hesitations}</td>
                      <td>{row.lateMisses}</td>
                      <td>
                        {row.avgRtMs === null ? '—' : `${row.avgRtMs}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ))}
        </>
      )}

      <div className="actions">
        {!isClip && (
          <button
            type="button"
            className="primary"
            onClick={() => liveStart(config, undefined, inputSource)}
          >
            Start another session
          </button>
        )}
        <button
          type="button"
          className="link"
          onClick={() => (isClip ? onClose?.() : liveReset())}
        >
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
