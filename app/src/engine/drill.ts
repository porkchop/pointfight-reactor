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
  SCORE_TABLE,
} from './types'
import { randInt, type RNG } from './rng'

export function pickPreCueDelayMs(rng: RNG, config: DrillConfig): number {
  return randInt(rng, config.preCueMinMs, config.preCueMaxMs)
}

export function pickNextCue(rng: RNG, config: DrillConfig): CueDef {
  if (config.distanceAxisEnabled) {
    if (CUE_LIBRARY.length === 0) {
      throw new Error('pickNextCue: empty library')
    }
    return CUE_LIBRARY[Math.floor(rng() * CUE_LIBRARY.length)]
  }
  const isGo = rng() < config.goCueProbability
  const pool = isGo ? GO_CUES : NO_GO_CUES
  if (pool.length === 0) {
    throw new Error('pickNextCue: empty pool')
  }
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
}

export interface ClassifyOutput {
  result: RepResult
  reactionMs: number | null
  score: number
}

export function classifyRep(input: ClassifyInput): ClassifyOutput {
  const { isGo, cueShownAt, pressedAt, responseWindowMs, hesitationThresholdMs } =
    input

  if (pressedAt !== null && pressedAt < cueShownAt) {
    return wrap('false_start', null)
  }

  const pressedInWindow =
    pressedAt !== null && pressedAt - cueShownAt <= responseWindowMs

  if (!pressedInWindow) {
    return wrap(isGo ? 'late' : 'correct_no_go', null)
  }

  const dt = Math.round((pressedAt as number) - cueShownAt)
  if (!isGo) {
    return wrap('false_start', dt)
  }

  return wrap(dt < hesitationThresholdMs ? 'correct_go' : 'hesitation', dt)
}

export function classifyPreCuePress(): ClassifyOutput {
  return wrap('false_start', null)
}

function wrap(result: RepResult, reactionMs: number | null): ClassifyOutput {
  return { result, reactionMs, score: SCORE_TABLE[result] }
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
