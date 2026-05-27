import { create } from 'zustand'
import {
  classifyPreCuePress,
  classifyRep,
  pickDistance,
  pickNextCue,
  pickPreCueDelayMs,
  resolveCueAtDistance,
  summarize,
  type ClassifyOutput,
} from '../engine/drill'
import {
  commitRep as commitRepHelper,
  mintSessionId,
  persistSessionRecord,
} from '../engine/persistence'
import { defaultRng, type RNG } from '../engine/rng'
import {
  DEFAULT_DRILL_CONFIG,
  type CueDef,
  type Distance,
  type DrillConfig,
  type InputSource,
  type RepRecord,
} from '../engine/types'

export type DrillPhase =
  | 'idle'
  | 'waiting'
  | 'showing'
  | 'feedback'
  | 'rest'
  | 'ended'

interface RepInFlight {
  cue: CueDef
  distance: Distance | null
  preCueStartedAt: number
  preCueDelayMs: number
  cueShownAt: number | null
}

export interface FeedbackState {
  rep: RepRecord
  cue: CueDef
}

interface SessionState {
  phase: DrillPhase
  sessionId: string | null
  sessionStartedAt: number | null
  config: DrillConfig
  current: RepInFlight | null
  feedback: FeedbackState | null
  reps: RepRecord[]
  persistError: string | null
  rng: RNG
  inputSource: InputSource
  roundIndex: number
  workEndAt: number | null
  restEndAt: number | null
  cleared: number

  start: (
    overrides?: Partial<DrillConfig>,
    rng?: RNG,
    inputSource?: InputSource,
  ) => void
  beginRep: () => void
  revealCue: () => void
  recordPress: (at: number) => void
  finishWindow: () => void
  acknowledgeFeedback: () => void
  nextRound: () => void
  clearPenalty: () => void
  stop: () => void
  reset: () => void
}

export const useSession = create<SessionState>((set, get) => {
  function persistSession(endedAt: number | null): void {
    const state = get()
    if (!state.sessionId || state.sessionStartedAt === null) return
    persistSessionRecord(
      {
        sessionId: state.sessionId,
        startedAt: state.sessionStartedAt,
        endedAt,
        reps: state.reps,
        inputSource: state.inputSource,
        config: state.config,
        cleared: state.cleared,
        penaltyCounterEnabled: state.config.penaltyCounterEnabled,
      },
      (err) => set({ persistError: err.message }),
    )
  }

  // Phase 6.3 — rep-minting + persistence is now centralized in
  // `engine/persistence.ts:commitRep`. This wrapper applies the
  // session-store side effects (phase transition, feedback hand-off,
  // session-progress save) on top of the shared rep-build path so
  // `clipmode/runner.ts` can call the same helper without duplicating
  // the invariants encoded here.
  function commitRep(
    cue: CueDef,
    distance: Distance | null,
    cueShownAt: number,
    pressedAt: number | null,
    classification: ClassifyOutput,
  ): void {
    const state = get()
    if (!state.sessionId || state.sessionStartedAt === null) return
    const { rep, feedback } = commitRepHelper({
      cue,
      distance,
      cueShownAt,
      pressedAt,
      classification,
      sessionId: state.sessionId,
      roundIndex: state.roundIndex,
      inputSource: state.inputSource,
    })
    set({
      phase: 'feedback',
      feedback,
      reps: [...state.reps, rep],
    })
    persistSession(null)
  }

  return {
    phase: 'idle',
    sessionId: null,
    sessionStartedAt: null,
    config: DEFAULT_DRILL_CONFIG,
    current: null,
    feedback: null,
    reps: [],
    persistError: null,
    rng: defaultRng,
    inputSource: 'keyboard',
    roundIndex: 0,
    workEndAt: null,
    restEndAt: null,
    cleared: 0,

    start: (overrides, rng, inputSource) => {
      const config = { ...DEFAULT_DRILL_CONFIG, ...overrides }
      const sessionId = mintSessionId()
      const startedAt = Date.now()
      set({
        phase: 'waiting',
        sessionId,
        sessionStartedAt: startedAt,
        config,
        current: null,
        feedback: null,
        reps: [],
        persistError: null,
        rng: rng ?? defaultRng,
        inputSource: inputSource ?? 'keyboard',
        roundIndex: 0,
        workEndAt: performance.now() + config.workMs,
        restEndAt: null,
        cleared: 0,
      })
      persistSession(null)
      get().beginRep()
    },

    beginRep: () => {
      const { config, phase, rng } = get()
      if (phase === 'idle' || phase === 'ended') return
      const cue = pickNextCue(rng, config)
      const distance = config.distanceAxisEnabled ? pickDistance(rng) : null
      const preCueDelayMs = pickPreCueDelayMs(rng, config)
      set({
        phase: 'waiting',
        feedback: null,
        current: {
          cue,
          distance,
          preCueStartedAt: performance.now(),
          preCueDelayMs,
          cueShownAt: null,
        },
      })
    },

    revealCue: () => {
      const { current } = get()
      if (!current) return
      set({
        phase: 'showing',
        current: { ...current, cueShownAt: performance.now() },
      })
    },

    recordPress: (at) => {
      const { phase, current, config } = get()
      if (!current) return

      if (phase === 'waiting') {
        commitRep(
          current.cue,
          current.distance,
          at,
          at,
          classifyPreCuePress(config.scoreWeights),
        )
        return
      }
      if (phase !== 'showing' || current.cueShownAt === null) return

      const effective = resolveCueAtDistance(current.cue, current.distance)
      const classification = classifyRep({
        isGo: effective.isGo,
        cueShownAt: current.cueShownAt,
        pressedAt: at,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
        lateThresholdMs: config.lateThresholdMs,
        scoreWeights: config.scoreWeights,
      })
      commitRep(
        current.cue,
        current.distance,
        current.cueShownAt,
        at,
        classification,
      )
    },

    finishWindow: () => {
      const { phase, current, config } = get()
      if (phase !== 'showing' || !current || current.cueShownAt === null) return
      const effective = resolveCueAtDistance(current.cue, current.distance)
      const classification = classifyRep({
        isGo: effective.isGo,
        cueShownAt: current.cueShownAt,
        pressedAt: null,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
        lateThresholdMs: config.lateThresholdMs,
        scoreWeights: config.scoreWeights,
      })
      commitRep(
        current.cue,
        current.distance,
        current.cueShownAt,
        null,
        classification,
      )
    },

    acknowledgeFeedback: () => {
      const { phase, config, reps, roundIndex, workEndAt } = get()
      if (phase !== 'feedback') return
      if (config.maxReps !== null && reps.length >= config.maxReps) {
        get().stop()
        return
      }
      const workExpired =
        workEndAt !== null && performance.now() >= workEndAt
      if (workExpired) {
        const isFinalRound = roundIndex >= config.rounds - 1
        if (isFinalRound) {
          get().stop()
          return
        }
        set({
          phase: 'rest',
          current: null,
          feedback: null,
          restEndAt: performance.now() + config.restMs,
        })
        return
      }
      get().beginRep()
    },

    nextRound: () => {
      const { phase, roundIndex, config } = get()
      if (phase !== 'rest') return
      const next = roundIndex + 1
      if (next >= config.rounds) {
        get().stop()
        return
      }
      set({
        roundIndex: next,
        workEndAt: performance.now() + config.workMs,
        restEndAt: null,
      })
      get().beginRep()
    },

    clearPenalty: () => {
      const { cleared } = get()
      set({ cleared: cleared + 1 })
      persistSession(null)
    },

    stop: () => {
      persistSession(Date.now())
      set({
        phase: 'ended',
        current: null,
        workEndAt: null,
        restEndAt: null,
      })
    },

    reset: () => {
      set({
        phase: 'idle',
        sessionId: null,
        sessionStartedAt: null,
        current: null,
        feedback: null,
        reps: [],
        persistError: null,
        roundIndex: 0,
        workEndAt: null,
        restEndAt: null,
        cleared: 0,
      })
    },
  }
})

export function getSessionSummary(reps: RepRecord[]) {
  return summarize(reps)
}
