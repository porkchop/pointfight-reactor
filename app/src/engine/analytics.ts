import { CUE_LIBRARY } from '../cues/library'
import type {
  CueId,
  DrillConfig,
  RepRecord,
  RepResult,
  SessionRecord,
} from './types'
import { DEFAULT_DRILL_CONFIG } from './types'
import { best10AvgOf, correctGoTimesOf } from './drill'

const CUE_IS_GO: Record<CueId, boolean> = (() => {
  const m = {} as Record<CueId, boolean>
  for (const c of CUE_LIBRARY) m[c.id] = c.isGo
  return m
})()

export interface SessionTrendPoint {
  sessionId: string
  startedAt: number
  reps: number
  falseStartRate: number
  hesitationRate: number
  lateRate: number
  avgRtMs: number | null
  best10AvgRtMs: number | null
  score: number
}

export interface CueTrendPoint {
  sessionId: string
  startedAt: number
  cueId: CueId
  reps: number
  avgRtMs: number | null
  errorRate: number
}

export interface CueAggregateRow {
  cueId: CueId
  isGo: boolean
  reps: number
  sessions: number
  avgRtMs: number | null
  best10AvgRtMs: number | null
  errorRate: number
  goWeakness: number | null
  noGoWeakness: number | null
}

export type CueCompareClassification =
  | 'both_measured'
  | 'both_error_only'
  | 'candidate_only'
  | 'baseline_only'

export interface CueCompareRow {
  cueId: CueId
  classification: CueCompareClassification
  deltaAvgRtMs: number | null
  deltaErrorRate: number
}

export interface SessionDelta {
  baselineId: string
  candidateId: string
  deltaAvgRtMs: number | null
  deltaScore: number | null
  deltaFalseStartRate: number
  deltaHesitationRate: number
  weightsDiffer: boolean
  perCue: CueCompareRow[]
}

export interface TaperRecommendation {
  cueIds: CueId[]
  reason: string
}

export interface TaperProfileBlueprint {
  config: DrillConfig
  reason: string
}

/**
 * Phase 5 — assemble a taper-mode DrillConfig from recent history. Pure;
 * the SettingsScreen handler does the persistence. Returns `null` if there
 * isn't enough data to pick at least one cue.
 *
 * Taper rule (decision-memo D6):
 *   rounds: 3 · workMs: 60s · restMs: 30s · maxReps: null
 *   allowedCueIds: pickTaperCues(cueAggregate(sessions, reps), k)
 *
 * `baseConfig` is the user's currently active profile config — we copy it so
 * the taper profile inherits their preferred thresholds / scoring weights.
 */
export function buildTaperProfileBlueprint(
  sessions: readonly SessionRecord[],
  repsBySession: Map<string, RepRecord[]>,
  baseConfig: DrillConfig = DEFAULT_DRILL_CONFIG,
  k = 3,
): TaperProfileBlueprint | null {
  const agg = cueAggregate(sessions, repsBySession)
  const rec = pickTaperCues(agg, k)
  if (rec.cueIds.length === 0) return null
  return {
    config: {
      ...baseConfig,
      rounds: 3,
      workMs: 60_000,
      restMs: 30_000,
      maxReps: null,
      allowedCueIds: rec.cueIds,
    },
    reason: rec.reason,
  }
}

// ---------------------------------------------------------------------------
// Per-session aggregators (small private helpers reused across exports)

function trendPointFromReps(
  sessionId: string,
  startedAt: number,
  reps: RepRecord[],
): SessionTrendPoint {
  const total = reps.length
  const goTimes = correctGoTimesOf(reps)
  const avg =
    goTimes.length === 0
      ? null
      : Math.round(goTimes.reduce((a, b) => a + b, 0) / goTimes.length)
  return {
    sessionId,
    startedAt,
    reps: total,
    falseStartRate:
      total === 0 ? 0 : reps.filter((r) => r.result === 'false_start').length / total,
    hesitationRate:
      total === 0 ? 0 : reps.filter((r) => r.result === 'hesitation').length / total,
    lateRate:
      total === 0 ? 0 : reps.filter((r) => r.result === 'late').length / total,
    avgRtMs: avg,
    best10AvgRtMs: best10AvgOf(goTimes),
    score: reps.reduce((a, r) => a + r.score, 0),
  }
}

// ---------------------------------------------------------------------------
// Public API

export function sessionTrend(
  sessions: readonly SessionRecord[],
  repsBySession: Map<string, RepRecord[]>,
): SessionTrendPoint[] {
  return sessions
    .filter((s) => (repsBySession.get(s.id) ?? []).length > 0)
    .map((s) =>
      trendPointFromReps(s.id, s.startedAt, repsBySession.get(s.id) ?? []),
    )
    .sort((a, b) => a.startedAt - b.startedAt)
}

export function cueTrend(
  sessions: readonly SessionRecord[],
  repsBySession: Map<string, RepRecord[]>,
): CueTrendPoint[] {
  const out: CueTrendPoint[] = []
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt)
  for (const s of ordered) {
    const reps = repsBySession.get(s.id) ?? []
    if (reps.length === 0) continue
    const byCue = new Map<CueId, RepRecord[]>()
    for (const r of reps) {
      const list = byCue.get(r.cueId) ?? []
      list.push(r)
      byCue.set(r.cueId, list)
    }
    for (const [cueId, list] of byCue) {
      const goTimes = correctGoTimesOf(list)
      const avg =
        goTimes.length === 0
          ? null
          : Math.round(goTimes.reduce((a, b) => a + b, 0) / goTimes.length)
      const correct = list.filter(
        (r) => r.result === 'correct_go' || r.result === 'correct_no_go',
      ).length
      out.push({
        sessionId: s.id,
        startedAt: s.startedAt,
        cueId,
        reps: list.length,
        avgRtMs: avg,
        errorRate: list.length === 0 ? 0 : (list.length - correct) / list.length,
      })
    }
  }
  return out
}

export function cueAggregate(
  sessions: readonly SessionRecord[],
  repsBySession: Map<string, RepRecord[]>,
): CueAggregateRow[] {
  const byCue = new Map<CueId, RepRecord[]>()
  const sessionsPerCue = new Map<CueId, Set<string>>()
  for (const s of sessions) {
    const reps = repsBySession.get(s.id) ?? []
    for (const r of reps) {
      const list = byCue.get(r.cueId) ?? []
      list.push(r)
      byCue.set(r.cueId, list)
      const sset = sessionsPerCue.get(r.cueId) ?? new Set<string>()
      sset.add(s.id)
      sessionsPerCue.set(r.cueId, sset)
    }
  }
  const rows: CueAggregateRow[] = []
  for (const [cueId, list] of byCue) {
    const isGo = CUE_IS_GO[cueId] ?? true
    const goTimes = correctGoTimesOf(list)
    const avg =
      goTimes.length === 0
        ? null
        : Math.round(goTimes.reduce((a, b) => a + b, 0) / goTimes.length)
    const correct = list.filter(
      (r) => r.result === 'correct_go' || r.result === 'correct_no_go',
    ).length
    const errorRate =
      list.length === 0 ? 0 : (list.length - correct) / list.length
    const goWeakness =
      isGo && avg !== null ? avg / 1000 + errorRate : null
    const noGoWeakness = !isGo ? errorRate : null
    rows.push({
      cueId,
      isGo,
      reps: list.length,
      sessions: sessionsPerCue.get(cueId)?.size ?? 0,
      avgRtMs: avg,
      best10AvgRtMs: best10AvgOf(goTimes),
      errorRate,
      goWeakness,
      noGoWeakness,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Taper picker — see decision-memo D5 for the go/no-go split rationale.

const MIN_REPS_PER_CUE = 5
const MIN_SESSIONS_PER_CUE = 2

function eligible(row: CueAggregateRow): boolean {
  return row.reps >= MIN_REPS_PER_CUE && row.sessions >= MIN_SESSIONS_PER_CUE
}

function byWeaknessDesc<K extends 'goWeakness' | 'noGoWeakness'>(
  field: K,
): (a: CueAggregateRow, b: CueAggregateRow) => number {
  return (a, b) => {
    const av = a[field] ?? -Infinity
    const bv = b[field] ?? -Infinity
    if (bv !== av) return bv - av
    return a.cueId < b.cueId ? -1 : a.cueId > b.cueId ? 1 : 0
  }
}

export function pickTaperCues(
  aggregate: readonly CueAggregateRow[],
  k: number,
): TaperRecommendation {
  if (k <= 0) return { cueIds: [], reason: 'k must be ≥ 1' }
  const eligibleRows = aggregate.filter(eligible)
  if (eligibleRows.length === 0) {
    return {
      cueIds: [],
      reason:
        'Not enough data — every cue has fewer than 5 reps across at least 2 sessions. Drill more variety first.',
    }
  }
  const goSlots = Math.max(1, Math.floor(k * 0.7))
  const noGoSlots = k - goSlots
  const goPool = eligibleRows
    .filter((r) => r.isGo && r.goWeakness !== null)
    .sort(byWeaknessDesc('goWeakness'))
  const noGoPool = eligibleRows
    .filter((r) => !r.isGo && r.noGoWeakness !== null)
    .sort(byWeaknessDesc('noGoWeakness'))

  // Take initial slots from each pool, then fill any deficit from the other.
  const goPicks = goPool.slice(0, goSlots)
  const noGoPicks = noGoPool.slice(0, noGoSlots)
  const goShort = goSlots - goPicks.length
  const noGoShort = noGoSlots - noGoPicks.length
  const filledFromNoGo = noGoPool
    .slice(noGoPicks.length, noGoPicks.length + goShort)
  const filledFromGo = goPool.slice(goPicks.length, goPicks.length + noGoShort)
  const all = [...goPicks, ...filledFromNoGo, ...noGoPicks, ...filledFromGo]
  const cueIds = all.map((r) => r.cueId)

  const goNames = goPicks.map((r) => r.cueId).join(', ')
  const noGoNames = noGoPicks.map((r) => r.cueId).join(', ')
  const parts: string[] = []
  if (goNames) parts.push(`slowest go cues: ${goNames}`)
  if (noGoNames) parts.push(`weakest no-go cues: ${noGoNames}`)
  if (filledFromNoGo.length > 0)
    parts.push(`extra no-go: ${filledFromNoGo.map((r) => r.cueId).join(', ')}`)
  if (filledFromGo.length > 0)
    parts.push(`extra go: ${filledFromGo.map((r) => r.cueId).join(', ')}`)
  const reason =
    cueIds.length === 0
      ? 'Not enough eligible cues. Drill more variety first.'
      : parts.join(' · ')
  return { cueIds, reason }
}

// ---------------------------------------------------------------------------
// Session comparison

function scoreByResultOf(reps: RepRecord[]): Map<RepResult, number> {
  const m = new Map<RepResult, number>()
  for (const r of reps) {
    if (!m.has(r.result)) m.set(r.result, r.score)
  }
  return m
}

function weightsDifferBetween(
  a: Map<RepResult, number>,
  b: Map<RepResult, number>,
): boolean {
  // Only flags when the two sessions both observed the same RepResult under
  // different scores. If their result sets don't overlap we under-detect —
  // but scoreWeights never change *within* a session, so the only path to a
  // false negative is two sessions whose result sets are disjoint, which in
  // practice doesn't happen for the run-length sessions this app produces.
  for (const [k, va] of a) {
    const vb = b.get(k)
    if (vb !== undefined && vb !== va) return true
  }
  return false
}

function cuePerf(
  reps: RepRecord[],
  cueId: CueId,
): { count: number; correct: number; avgRtMs: number | null; errorRate: number } {
  const list = reps.filter((r) => r.cueId === cueId)
  if (list.length === 0) {
    return { count: 0, correct: 0, avgRtMs: null, errorRate: 0 }
  }
  const correct = list.filter(
    (r) => r.result === 'correct_go' || r.result === 'correct_no_go',
  ).length
  const goTimes = correctGoTimesOf(list)
  const avg =
    goTimes.length === 0
      ? null
      : Math.round(goTimes.reduce((a, b) => a + b, 0) / goTimes.length)
  return {
    count: list.length,
    correct,
    avgRtMs: avg,
    errorRate: (list.length - correct) / list.length,
  }
}

export function compareSessions(
  baseline: SessionRecord,
  candidate: SessionRecord,
  baselineReps: RepRecord[],
  candidateReps: RepRecord[],
): SessionDelta {
  const baseTrend = trendPointFromReps(
    baseline.id,
    baseline.startedAt,
    baselineReps,
  )
  const candTrend = trendPointFromReps(
    candidate.id,
    candidate.startedAt,
    candidateReps,
  )
  const weightsDiffer = weightsDifferBetween(
    scoreByResultOf(baselineReps),
    scoreByResultOf(candidateReps),
  )
  const cueIds = new Set<CueId>()
  for (const r of baselineReps) cueIds.add(r.cueId)
  for (const r of candidateReps) cueIds.add(r.cueId)
  const perCue: CueCompareRow[] = []
  for (const cueId of cueIds) {
    const a = cuePerf(baselineReps, cueId)
    const b = cuePerf(candidateReps, cueId)
    if (a.count === 0 && b.count > 0) {
      perCue.push({
        cueId,
        classification: 'candidate_only',
        deltaAvgRtMs: null,
        deltaErrorRate: 0,
      })
      continue
    }
    if (b.count === 0 && a.count > 0) {
      perCue.push({
        cueId,
        classification: 'baseline_only',
        deltaAvgRtMs: null,
        deltaErrorRate: 0,
      })
      continue
    }
    if (a.avgRtMs === null || b.avgRtMs === null) {
      // Both sides have reps but at least one has zero correct_go RTs.
      perCue.push({
        cueId,
        classification: 'both_error_only',
        deltaAvgRtMs: null,
        deltaErrorRate: b.errorRate - a.errorRate,
      })
      continue
    }
    perCue.push({
      cueId,
      classification: 'both_measured',
      deltaAvgRtMs: b.avgRtMs - a.avgRtMs,
      deltaErrorRate: b.errorRate - a.errorRate,
    })
  }
  perCue.sort((x, y) => (x.cueId < y.cueId ? -1 : x.cueId > y.cueId ? 1 : 0))

  const deltaAvgRtMs =
    baseTrend.avgRtMs === null || candTrend.avgRtMs === null
      ? null
      : candTrend.avgRtMs - baseTrend.avgRtMs

  return {
    baselineId: baseline.id,
    candidateId: candidate.id,
    deltaAvgRtMs,
    deltaScore: weightsDiffer ? null : candTrend.score - baseTrend.score,
    deltaFalseStartRate: candTrend.falseStartRate - baseTrend.falseStartRate,
    deltaHesitationRate: candTrend.hesitationRate - baseTrend.hesitationRate,
    weightsDiffer,
    perCue,
  }
}
