export type CueId =
  | 'steps_in'
  | 'blitzes'
  | 'lifts_lead_leg'
  | 'drops_lead_hand'
  | 'retreats'
  | 'freezes'
  | 'fake_steps'
  | 'no_go_bait'

export type ResponseId =
  | 'blitz'
  | 'stop_kick'
  | 'angle_counter'
  | 'jam_entry'
  | 'evade_reset'
  | 'do_nothing'

export type Distance = 'far' | 'mid' | 'in_range'

export const DISTANCES: readonly Distance[] = ['far', 'mid', 'in_range']

export interface CueDistanceEntry {
  isGo: boolean
  expectedResponse: ResponseId
}

export interface CueDef {
  id: CueId
  label: string
  description: string
  isGo: boolean
  expectedResponse: ResponseId
  byDistance?: Record<Distance, CueDistanceEntry>
}

export type RepResult =
  | 'correct_go'
  | 'correct_no_go'
  | 'late'
  | 'false_start'
  | 'hesitation'

export type InputSource = 'keyboard' | 'pedal'

export interface RepRecord {
  id: string
  sessionId: string
  cueId: CueId
  isGo: boolean
  result: RepResult
  reactionMs: number | null
  score: number
  cueShownAt: number
  pressedAt: number | null
  roundIndex: number
  inputSource: InputSource
  distance?: Distance
}

export interface SessionSummary {
  reps: number
  correct: number
  falseStarts: number
  lateMisses: number
  hesitations: number
  score: number
  avgReactionMs: number | null
}

export interface SessionRecord {
  id: string
  startedAt: number
  endedAt: number | null
  drillType: 'first_beat_go_no_go'
  repCount: number
  summary: SessionSummary
  inputSource?: InputSource
  rounds?: number
  workMs?: number
  restMs?: number
  cleared?: number
  penaltyCounterEnabled?: boolean
}

export interface PhoneCalibration {
  /** Calibrated commit threshold in g (from `phone/motion.ts`). */
  thresholdG: number
  /** Wall-clock timestamp of the calibration run. */
  calibratedAt: number
}

export interface DrillConfig {
  preCueMinMs: number
  preCueMaxMs: number
  responseWindowMs: number
  hesitationThresholdMs: number
  lateThresholdMs: number
  goCueProbability: number
  maxReps: number | null
  rounds: number
  workMs: number
  restMs: number
  penaltyCounterEnabled: boolean
  perFalseStartPenalty: number
  perHesitationPenalty: number
  distanceAxisEnabled: boolean
  audioToneEnabled: boolean
  textOverlayEnabled: boolean
  allowedCueIds: CueId[] | null
  scoreWeights: Record<RepResult, number>
  /**
   * Per-athlete motion threshold, fitted by the Phase 2b.3 calibration
   * flow. Optional: profiles without a calibration fall back to
   * `DEFAULT_THRESHOLD_G` from `phone/motion.ts`.
   */
  phoneCalibration?: PhoneCalibration
}

export const PRE_CUE_MIN_FLOOR_MS = 500
export const PRE_CUE_MAX_CEILING_MS = 8000

export const DEFAULT_SCORE_WEIGHTS: Record<RepResult, number> = {
  correct_go: 1,
  correct_no_go: 1,
  late: 0,
  false_start: -1,
  hesitation: -2,
}

export const DEFAULT_DRILL_CONFIG: DrillConfig = {
  preCueMinMs: 1500,
  preCueMaxMs: 4000,
  responseWindowMs: 1200,
  hesitationThresholdMs: 450,
  lateThresholdMs: 600,
  goCueProbability: 0.7,
  maxReps: null,
  rounds: 5,
  workMs: 120_000,
  restMs: 60_000,
  penaltyCounterEnabled: false,
  perFalseStartPenalty: 1,
  perHesitationPenalty: 1,
  distanceAxisEnabled: false,
  audioToneEnabled: false,
  textOverlayEnabled: false,
  allowedCueIds: null,
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
}

