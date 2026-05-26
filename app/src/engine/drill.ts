import { CUE_LIBRARY, GO_CUES, NO_GO_CUES } from '../cues/library'
import type {
  CueDef,
  CueDistanceEntry,
  Distance,
  DrillConfig,
  RepRecord,
  RepResult,
  SessionSummary,
} from './types'
import {
  DISTANCES,
  PRE_CUE_MAX_CEILING_MS,
  PRE_CUE_MIN_FLOOR_MS,
} from './types'
import { randInt, type RNG } from './rng'

export function pickPreCueDelayMs(rng: RNG, config: DrillConfig): number {
  return randInt(rng, config.preCueMinMs, config.preCueMaxMs)
}

function filterByAllowed(
  cues: readonly CueDef[],
  allowed: CueDef['id'][] | null,
): readonly CueDef[] {
  if (!allowed || allowed.length === 0) return cues
  const set = new Set(allowed)
  return cues.filter((c) => set.has(c.id))
}

export function pickNextCue(rng: RNG, config: DrillConfig): CueDef {
  if (config.distanceAxisEnabled) {
    const pool = filterByAllowed(CUE_LIBRARY, config.allowedCueIds)
    if (pool.length === 0) {
      throw new Error('pickNextCue: empty library after allowedCueIds filter')
    }
    return pool[Math.floor(rng() * pool.length)]
  }
  const allowedGo = filterByAllowed(GO_CUES, config.allowedCueIds)
  const allowedNoGo = filterByAllowed(NO_GO_CUES, config.allowedCueIds)
  const goEmpty = allowedGo.length === 0
  const noGoEmpty = allowedNoGo.length === 0
  if (goEmpty && noGoEmpty) {
    throw new Error('pickNextCue: empty allowedCueIds filter')
  }
  const wantGo = goEmpty ? false : noGoEmpty ? true : rng() < config.goCueProbability
  const pool = wantGo ? allowedGo : allowedNoGo
  return pool[Math.floor(rng() * pool.length)]
}

export function pickDistance(rng: RNG): Distance {
  return DISTANCES[Math.floor(rng() * DISTANCES.length)]
}

export function resolveCueAtDistance(
  cue: CueDef,
  distance: Distance | null,
): CueDistanceEntry {
  if (distance !== null && cue.byDistance) {
    return cue.byDistance[distance]
  }
  return { isGo: cue.isGo, expectedResponse: cue.expectedResponse }
}

export interface ClassifyInput {
  isGo: boolean
  cueShownAt: number
  pressedAt: number | null
  responseWindowMs: number
  hesitationThresholdMs: number
  lateThresholdMs: number
  scoreWeights: Record<RepResult, number>
}

export interface ClassifyOutput {
  result: RepResult
  reactionMs: number | null
  score: number
}

export function classifyRep(input: ClassifyInput): ClassifyOutput {
  const {
    isGo,
    cueShownAt,
    pressedAt,
    responseWindowMs,
    hesitationThresholdMs,
    lateThresholdMs,
    scoreWeights,
  } = input

  if (pressedAt !== null && pressedAt < cueShownAt) {
    return wrap('false_start', null, scoreWeights)
  }

  const pressedInWindow =
    pressedAt !== null && pressedAt - cueShownAt <= responseWindowMs

  if (!pressedInWindow) {
    return wrap(isGo ? 'late' : 'correct_no_go', null, scoreWeights)
  }

  const dt = Math.round((pressedAt as number) - cueShownAt)
  if (!isGo) {
    return wrap('false_start', dt, scoreWeights)
  }

  let result: RepResult
  if (dt < hesitationThresholdMs) result = 'correct_go'
  else if (dt < lateThresholdMs) result = 'hesitation'
  else result = 'late'
  return wrap(result, dt, scoreWeights)
}

export function classifyPreCuePress(
  scoreWeights: Record<RepResult, number>,
): ClassifyOutput {
  return wrap('false_start', null, scoreWeights)
}

function wrap(
  result: RepResult,
  reactionMs: number | null,
  scoreWeights: Record<RepResult, number>,
): ClassifyOutput {
  return { result, reactionMs, score: scoreWeights[result] }
}

export interface ValidationError {
  field: keyof DrillConfig
  message: string
}

export function validateDrillConfig(config: DrillConfig): ValidationError[] {
  const errors: ValidationError[] = []
  if (config.preCueMinMs < PRE_CUE_MIN_FLOOR_MS) {
    errors.push({
      field: 'preCueMinMs',
      message: `must be ≥ ${PRE_CUE_MIN_FLOOR_MS}ms`,
    })
  }
  if (config.preCueMaxMs > PRE_CUE_MAX_CEILING_MS) {
    errors.push({
      field: 'preCueMaxMs',
      message: `must be ≤ ${PRE_CUE_MAX_CEILING_MS}ms`,
    })
  }
  if (config.preCueMinMs > config.preCueMaxMs) {
    errors.push({
      field: 'preCueMaxMs',
      message: 'must be ≥ min',
    })
  }
  if (config.rounds < 1) {
    errors.push({ field: 'rounds', message: 'must be ≥ 1' })
  }
  if (config.workMs < 1_000) {
    errors.push({ field: 'workMs', message: 'must be ≥ 1s' })
  }
  if (config.restMs < 0) {
    errors.push({ field: 'restMs', message: 'must be ≥ 0' })
  }
  if (config.perFalseStartPenalty < 0) {
    errors.push({ field: 'perFalseStartPenalty', message: 'must be ≥ 0' })
  }
  if (config.perHesitationPenalty < 0) {
    errors.push({ field: 'perHesitationPenalty', message: 'must be ≥ 0' })
  }
  if (config.hesitationThresholdMs > config.lateThresholdMs) {
    errors.push({
      field: 'lateThresholdMs',
      message: 'must be ≥ hesitation threshold',
    })
  }
  if (config.lateThresholdMs > config.responseWindowMs) {
    errors.push({
      field: 'responseWindowMs',
      message: 'must be ≥ late threshold',
    })
  }
  if (config.allowedCueIds && config.allowedCueIds.length === 0) {
    errors.push({
      field: 'allowedCueIds',
      message: 'must include at least one cue (or null for all)',
    })
  }
  if (config.allowedCueIds && !config.distanceAxisEnabled) {
    const allowed = new Set(config.allowedCueIds)
    const hasGo = GO_CUES.some((c) => allowed.has(c.id))
    if (!hasGo) {
      errors.push({
        field: 'allowedCueIds',
        message:
          'must include at least one go cue when distance axis is disabled',
      })
    }
  }
  return errors
}

export function pendingPenalties(
  reps: RepRecord[],
  perFalseStart: number,
  perHesitation: number,
  cleared: number,
): number {
  const earned = reps.reduce((sum, r) => {
    if (r.result === 'false_start') return sum + perFalseStart
    if (r.result === 'hesitation') return sum + perHesitation
    return sum
  }, 0)
  return Math.max(0, earned - cleared)
}

export interface CueBreakdownRow {
  cueId: CueDef['id']
  reps: number
  correct: number
  falseStarts: number
  hesitations: number
  lateMisses: number
  avgRtMs: number | null
  best10AvgRtMs: number | null
}

export function cueBreakdown(reps: RepRecord[]): CueBreakdownRow[] {
  const byId = new Map<CueDef['id'], RepRecord[]>()
  for (const r of reps) {
    const list = byId.get(r.cueId) ?? []
    list.push(r)
    byId.set(r.cueId, list)
  }
  return Array.from(byId.entries()).map(([cueId, list]) => {
    const correctGoTimes = list
      .filter((r) => r.result === 'correct_go' && r.reactionMs !== null)
      .map((r) => r.reactionMs as number)
    const avgRtMs =
      correctGoTimes.length === 0
        ? null
        : Math.round(
            correctGoTimes.reduce((a, b) => a + b, 0) / correctGoTimes.length,
          )
    const sorted = [...correctGoTimes].sort((a, b) => a - b).slice(0, 10)
    const best10AvgRtMs =
      sorted.length === 0
        ? null
        : Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
    return {
      cueId,
      reps: list.length,
      correct: list.filter(
        (r) => r.result === 'correct_go' || r.result === 'correct_no_go',
      ).length,
      falseStarts: list.filter((r) => r.result === 'false_start').length,
      hesitations: list.filter((r) => r.result === 'hesitation').length,
      lateMisses: list.filter((r) => r.result === 'late').length,
      avgRtMs,
      best10AvgRtMs,
    }
  })
}

export type PriorGoStreakBucket = '0' | '1' | '2' | '3+'

export interface AntiRhythmStats {
  overallFalseStartRate: number
  buckets: Record<PriorGoStreakBucket, { falseStarts: number; total: number }>
  narrative: string
}

function priorGoStreakBucketOf(n: number): PriorGoStreakBucket {
  if (n <= 0) return '0'
  if (n === 1) return '1'
  if (n === 2) return '2'
  return '3+'
}

export function antiRhythmSignal(reps: RepRecord[]): AntiRhythmStats {
  const buckets: AntiRhythmStats['buckets'] = {
    '0': { falseStarts: 0, total: 0 },
    '1': { falseStarts: 0, total: 0 },
    '2': { falseStarts: 0, total: 0 },
    '3+': { falseStarts: 0, total: 0 },
  }
  let streak = 0
  let totalGoReps = 0
  let totalFalseStarts = 0
  for (const r of reps) {
    if (r.isGo) {
      const b = priorGoStreakBucketOf(streak)
      buckets[b].total += 1
      if (r.result === 'false_start') buckets[b].falseStarts += 1
      totalGoReps += 1
      if (r.result === 'false_start') totalFalseStarts += 1
      streak += 1
    } else {
      streak = 0
    }
  }
  const overallFalseStartRate =
    totalGoReps === 0 ? 0 : totalFalseStarts / totalGoReps

  let narrative = 'No rhythm pattern detected.'
  let bestBucket: PriorGoStreakBucket | null = null
  let bestRate = -1
  for (const key of Object.keys(buckets) as PriorGoStreakBucket[]) {
    const b = buckets[key]
    if (b.total < 3) continue
    const rate = b.falseStarts / b.total
    if (
      rate > bestRate &&
      overallFalseStartRate > 0 &&
      rate >= overallFalseStartRate * 1.5
    ) {
      bestRate = rate
      bestBucket = key
    }
  }
  if (bestBucket !== null) {
    const pct = Math.round(bestRate * 100)
    const label =
      bestBucket === '0'
        ? 'a non-go cue'
        : bestBucket === '3+'
          ? '3+ consecutive go cues'
          : `${bestBucket} consecutive go cue${bestBucket === '1' ? '' : 's'}`
    narrative = `False starts most often after ${label} (${pct}%).`
  }

  return { overallFalseStartRate, buckets, narrative }
}

export function summarize(reps: RepRecord[]): SessionSummary {
  const reactionTimes = reps
    .filter((r) => r.result === 'correct_go' && r.reactionMs !== null)
    .map((r) => r.reactionMs as number)

  const avgReactionMs =
    reactionTimes.length === 0
      ? null
      : Math.round(
          reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length,
        )

  return {
    reps: reps.length,
    correct: reps.filter(
      (r) => r.result === 'correct_go' || r.result === 'correct_no_go',
    ).length,
    falseStarts: reps.filter((r) => r.result === 'false_start').length,
    lateMisses: reps.filter((r) => r.result === 'late').length,
    hesitations: reps.filter((r) => r.result === 'hesitation').length,
    score: reps.reduce((a, r) => a + r.score, 0),
    avgReactionMs,
  }
}
