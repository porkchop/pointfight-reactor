import { useEffect, useMemo, useState } from 'react'
import {
  compareSessions,
  cueAggregate,
  cueTrend,
  sessionTrend,
  type CueAggregateRow,
  type CueCompareRow,
  type CueTrendPoint,
  type SessionDelta,
  type SessionTrendPoint,
} from '../engine/analytics'
import { CUE_LIBRARY } from '../cues/library'
import { listRecentSessions, listRepsForSessions } from '../store/db'
import type { CueId, RepRecord, SessionRecord } from '../engine/types'

interface AnalyticsScreenProps {
  onClose: () => void
}

const HISTORY_LIMIT = 20

export function AnalyticsScreen({ onClose }: AnalyticsScreenProps) {
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [repsBySession, setRepsBySession] = useState<Map<string, RepRecord[]>>(
    new Map(),
  )
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const [candidateId, setCandidateId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const sess = await listRecentSessions(HISTORY_LIMIT)
      const reps = await listRepsForSessions(sess.map((s) => s.id))
      if (cancelled) return
      setSessions(sess)
      setRepsBySession(reps)
      // Default comparison: most-recent vs second-most-recent (with reps).
      const populated = sess.filter((s) => (reps.get(s.id) ?? []).length > 0)
      if (populated.length >= 2) {
        setCandidateId(populated[0].id)
        setBaselineId(populated[1].id)
      } else if (populated.length === 1) {
        setCandidateId(populated[0].id)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const trend: SessionTrendPoint[] = useMemo(
    () => sessionTrend(sessions, repsBySession),
    [sessions, repsBySession],
  )
  const cueTrendRows: CueTrendPoint[] = useMemo(
    () => cueTrend(sessions, repsBySession),
    [sessions, repsBySession],
  )
  const cueAgg: CueAggregateRow[] = useMemo(
    () => cueAggregate(sessions, repsBySession),
    [sessions, repsBySession],
  )

  const delta: SessionDelta | null = useMemo(() => {
    if (!baselineId || !candidateId || baselineId === candidateId) return null
    const baseline = sessions.find((s) => s.id === baselineId)
    const candidate = sessions.find((s) => s.id === candidateId)
    if (!baseline || !candidate) return null
    return compareSessions(
      baseline,
      candidate,
      repsBySession.get(baseline.id) ?? [],
      repsBySession.get(candidate.id) ?? [],
    )
  }, [baselineId, candidateId, sessions, repsBySession])

  if (loading) {
    return (
      <div className="screen analytics">
        <header className="analytics-header">
          <h1>Analytics</h1>
          <button type="button" className="link" onClick={onClose}>
            Back
          </button>
        </header>
        <p>Loading sessions…</p>
      </div>
    )
  }

  if (trend.length === 0) {
    return (
      <div className="screen analytics">
        <header className="analytics-header">
          <h1>Analytics</h1>
          <button type="button" className="link" onClick={onClose}>
            Back
          </button>
        </header>
        <p className="muted">No sessions yet. Run a drill first.</p>
      </div>
    )
  }

  return (
    <div className="screen analytics">
      <header className="analytics-header">
        <h1>Analytics</h1>
        <button type="button" className="link" onClick={onClose}>
          Back
        </button>
      </header>

      <SessionTrendSection trend={trend} />
      <CueTrendSection trendRows={cueTrendRows} aggregates={cueAgg} />
      <CompareSection
        sessions={sessions}
        trend={trend}
        baselineId={baselineId}
        candidateId={candidateId}
        onBaseline={setBaselineId}
        onCandidate={setCandidateId}
        delta={delta}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function SessionTrendSection({ trend }: { trend: SessionTrendPoint[] }) {
  const avgRtSeries = trend.map((t) => t.avgRtMs)
  const best10Series = trend.map((t) => t.best10AvgRtMs)
  const fsSeries = trend.map((t) => t.falseStartRate)
  const hesSeries = trend.map((t) => t.hesitationRate)
  return (
    <section className="analytics-section">
      <h2>Trend (last {trend.length} session{trend.length === 1 ? '' : 's'})</h2>
      <div className="trend-spark-grid">
        <SparkRow label="Avg RT (ms)" series={avgRtSeries} />
        <SparkRow label="Best-10 RT (ms)" series={best10Series} />
        <SparkRow label="False-start rate" series={fsSeries} />
        <SparkRow label="Hesitation rate" series={hesSeries} />
      </div>
      <table className="cue-table trend-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Reps</th>
            <th>Avg RT</th>
            <th>Best-10</th>
            <th>FS rate</th>
            <th>Hes rate</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((t) => (
            <tr key={t.sessionId}>
              <td>{new Date(t.startedAt).toLocaleString()}</td>
              <td>{t.reps}</td>
              <td>{t.avgRtMs === null ? '—' : `${t.avgRtMs}`}</td>
              <td>{t.best10AvgRtMs === null ? '—' : `${t.best10AvgRtMs}`}</td>
              <td>{fmtPct(t.falseStartRate)}</td>
              <td>{fmtPct(t.hesitationRate)}</td>
              <td>{t.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function CueTrendSection({
  trendRows,
  aggregates,
}: {
  trendRows: CueTrendPoint[]
  aggregates: CueAggregateRow[]
}) {
  const sessionsAsc = useMemo(() => {
    const seen = new Map<string, number>()
    for (const r of trendRows) seen.set(r.sessionId, r.startedAt)
    return Array.from(seen.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id)
  }, [trendRows])
  const byCueByStart = useMemo(() => {
    const m = new Map<CueId, Map<string, CueTrendPoint>>()
    for (const r of trendRows) {
      const inner = m.get(r.cueId) ?? new Map<string, CueTrendPoint>()
      inner.set(r.sessionId, r)
      m.set(r.cueId, inner)
    }
    return m
  }, [trendRows])
  const aggById = useMemo(() => {
    const m = new Map<CueId, CueAggregateRow>()
    for (const a of aggregates) m.set(a.cueId, a)
    return m
  }, [aggregates])
  return (
    <section className="analytics-section">
      <h2>Reaction time by cue type</h2>
      <table className="cue-table">
        <thead>
          <tr>
            <th>Cue</th>
            <th>Reps</th>
            <th>Avg RT</th>
            <th>Best-10</th>
            <th>Error rate</th>
            <th>RT trend</th>
          </tr>
        </thead>
        <tbody>
          {CUE_LIBRARY.map((cue) => {
            const agg = aggById.get(cue.id)
            if (!agg) return null
            const perSession = sessionsAsc.map(
              (sid) => byCueByStart.get(cue.id)?.get(sid)?.avgRtMs ?? null,
            )
            return (
              <tr key={cue.id}>
                <td>
                  {cue.label}{' '}
                  <span className="tag">{cue.isGo ? 'go' : 'no-go'}</span>
                </td>
                <td>{agg.reps}</td>
                <td>{agg.avgRtMs === null ? '—' : `${agg.avgRtMs}`}</td>
                <td>
                  {agg.best10AvgRtMs === null ? '—' : `${agg.best10AvgRtMs}`}
                </td>
                <td>{fmtPct(agg.errorRate)}</td>
                <td>
                  <Spark series={perSession} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function CompareSection({
  sessions,
  trend,
  baselineId,
  candidateId,
  onBaseline,
  onCandidate,
  delta,
}: {
  sessions: SessionRecord[]
  trend: SessionTrendPoint[]
  baselineId: string | null
  candidateId: string | null
  onBaseline: (id: string) => void
  onCandidate: (id: string) => void
  delta: SessionDelta | null
}) {
  const populated = useMemo(() => {
    const ids = new Set(trend.map((t) => t.sessionId))
    return sessions.filter((s) => ids.has(s.id))
  }, [sessions, trend])
  if (populated.length < 2) {
    return (
      <section className="analytics-section">
        <h2>Compare sessions</h2>
        <p className="muted">Need at least two sessions with reps to compare.</p>
      </section>
    )
  }
  return (
    <section className="analytics-section">
      <h2>Compare sessions</h2>
      <div className="compare-pickers">
        <label>
          <span>Baseline</span>
          <select
            value={baselineId ?? ''}
            onChange={(e) => onBaseline(e.target.value)}
            aria-label="baseline session"
          >
            {populated.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.startedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Candidate</span>
          <select
            value={candidateId ?? ''}
            onChange={(e) => onCandidate(e.target.value)}
            aria-label="candidate session"
          >
            {populated.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.startedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </div>
      {delta && <DeltaPanel delta={delta} />}
    </section>
  )
}

function DeltaPanel({ delta }: { delta: SessionDelta }) {
  return (
    <>
      <div className="stats compare-stats">
        <DeltaStat
          label="Δ Avg RT"
          value={delta.deltaAvgRtMs}
          suffix=" ms"
          lowerBetter
        />
        <DeltaStat
          label="Δ Score"
          value={delta.deltaScore}
          title={
            delta.weightsDiffer
              ? 'Score weights differed; compare per-result rates instead.'
              : undefined
          }
        />
        <DeltaStat
          label="Δ FS rate"
          value={delta.deltaFalseStartRate}
          asPct
          lowerBetter
        />
        <DeltaStat
          label="Δ Hes rate"
          value={delta.deltaHesitationRate}
          asPct
          lowerBetter
        />
      </div>
      <table className="cue-table compare-table">
        <thead>
          <tr>
            <th>Cue</th>
            <th>Status</th>
            <th>Δ RT</th>
            <th>Δ Error rate</th>
          </tr>
        </thead>
        <tbody>
          {delta.perCue.map((row) => (
            <tr key={row.cueId} className={classifyRowClass(row)}>
              <td>{cueLabel(row.cueId)}</td>
              <td>{classifyLabel(row)}</td>
              <td>{row.deltaAvgRtMs === null ? '—' : signed(row.deltaAvgRtMs)}</td>
              <td>{fmtSignedPct(row.deltaErrorRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function DeltaStat({
  label,
  value,
  suffix,
  asPct,
  lowerBetter,
  title,
}: {
  label: string
  value: number | null
  suffix?: string
  asPct?: boolean
  lowerBetter?: boolean
  title?: string
}) {
  const display =
    value === null
      ? '—'
      : asPct
        ? fmtSignedPct(value)
        : `${signed(value)}${suffix ?? ''}`
  const tone =
    value === null || value === 0
      ? 'neutral'
      : lowerBetter
        ? value < 0
          ? 'good'
          : 'bad'
        : value > 0
          ? 'good'
          : 'bad'
  return (
    <div className={`stat delta-${tone}`} title={title}>
      <span className="stat-value">{display}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tiny inline sparkline (no dep).

const SPARK_W = 120
const SPARK_H = 28
const SPARK_PAD = 2

function SparkRow({
  label,
  series,
}: {
  label: string
  series: (number | null)[]
}) {
  return (
    <div className="spark-row">
      <span className="spark-label">{label}</span>
      <Spark series={series} />
    </div>
  )
}

function Spark({ series }: { series: (number | null)[] }) {
  const nums = series.filter((v): v is number => v !== null)
  if (nums.length < 2) {
    return <span className="spark-empty">—</span>
  }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1
  const stepX = (SPARK_W - SPARK_PAD * 2) / (series.length - 1)
  const points = series
    .map((v, i) => {
      if (v === null) return null
      const x = SPARK_PAD + i * stepX
      const y =
        SPARK_PAD + ((max - v) / span) * (SPARK_H - SPARK_PAD * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter((p): p is string => p !== null)
    .join(' ')
  return (
    <svg
      className="spark"
      width={SPARK_W}
      height={SPARK_H}
      role="img"
      aria-label="trend sparkline"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.4} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Display helpers

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function fmtSignedPct(rate: number): string {
  const pts = Math.round(rate * 100)
  if (pts > 0) return `+${pts} pts`
  if (pts < 0) return `${pts} pts`
  return '0 pts'
}

function signed(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `${n}`
  return '0'
}

function cueLabel(id: CueId): string {
  return CUE_LIBRARY.find((c) => c.id === id)?.label ?? id
}

function classifyLabel(row: CueCompareRow): string {
  switch (row.classification) {
    case 'both_measured':
      return 'measured both'
    case 'both_error_only':
      return 'no successful go reps'
    case 'candidate_only':
      return 'new cue this session'
    case 'baseline_only':
      return 'not drilled this session'
  }
}

function classifyRowClass(row: CueCompareRow): string {
  return `compare-row compare-${row.classification}`
}
