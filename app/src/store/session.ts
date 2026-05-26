import { create } from 'zustand'
import {
  classifyPreCuePress,
  classifyRep,
  pickNextCue,
  pickPreCueDelayMs,
  summarize,
  type ClassifyOutput,
} from '../engine/drill'
import { defaultRng, type RNG } from '../engine/rng'
import {
  DEFAULT_DRILL_CONFIG,
  type CueDef,
  type DrillConfig,
  type InputSource,
  type RepRecord,
  type SessionRecord,
} from '../engine/types'
import { saveRep, saveSession } from './db'

export type DrillPhase =
  | 'idle'
  | 'waiting'
  | 'showing'
  | 'feedback'
  | 'rest'
  | 'ended'

interface RepInFlight {
  cue: CueDef
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

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const useSession = create<SessionState>((set, get) => {
  function persistSession(endedAt: number | null): void {
    const state = get()
    if (!state.sessionId || state.sessionStartedAt === null) return
    const record: SessionRecord = {
      id: state.sessionId,
      startedAt: state.sessionStartedAt,
      endedAt,
      drillType: 'first_beat_go_no_go',
      repCount: state.reps.length,
      summary: summarize(state.reps),
      inputSource: state.inputSource,
      rounds: state.config.rounds,
      workMs: state.config.workMs,
      restMs: state.config.restMs,
      cleared: state.cleared,
      penaltyCounterEnabled: state.config.penaltyCounterEnabled,
    }
    void saveSession(record).catch((err) => {
      set({ persistError: (err as Error).message })
    })
  }

  function commitRep(
    cue: CueDef,
    cueShownAt: number,
    pressedAt: number | null,
    classification: ClassifyOutput,
  ): void {
    const state = get()
    if (!state.sessionId || state.sessionStartedAt === null) return
    const rep: RepRecord = {
      id: newId(),
      sessionId: state.sessionId,
      cueId: cue.id,
      isGo: cue.isGo,
      result: classification.result,
      reactionMs: classification.reactionMs,
      score: classification.score,
      cueShownAt,
      pressedAt,
      roundIndex: state.roundIndex,
      inputSource: state.inputSource,
    }
    void saveRep(rep)
    const nextReps = [...state.reps, rep]
    set({
      phase: 'feedback',
      feedback: { rep, cue },
      reps: nextReps,
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
      const sessionId = newId()
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
      const preCueDelayMs = pickPreCueDelayMs(rng, config)
      set({
        phase: 'waiting',
        feedback: null,
        current: {
          cue,
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
        commitRep(current.cue, at, at, classifyPreCuePress())
        return
      }
      if (phase !== 'showing' || current.cueShownAt === null) return

      const classification = classifyRep({
        cue: current.cue,
        cueShownAt: current.cueShownAt,
        pressedAt: at,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
      })
      commitRep(current.cue, current.cueShownAt, at, classification)
    },

    finishWindow: () => {
      const { phase, current, config } = get()
      if (phase !== 'showing' || !current || current.cueShownAt === null) return
      const classification = classifyRep({
        cue: current.cue,
        cueShownAt: current.cueShownAt,
        pressedAt: null,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
      })
      commitRep(current.cue, current.cueShownAt, null, classification)
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
