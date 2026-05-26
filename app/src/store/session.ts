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
  type RepRecord,
  type SessionRecord,
} from '../engine/types'
import { saveRep, saveSession } from './db'

export type DrillPhase =
  | 'idle'
  | 'waiting'
  | 'showing'
  | 'feedback'
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

  start: (overrides?: Partial<DrillConfig>, rng?: RNG) => void
  beginRep: () => void
  revealCue: () => void
  recordPress: (at: number) => void
  finishWindow: () => void
  acknowledgeFeedback: () => void
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
  function persistSession(
    sessionId: string,
    startedAt: number,
    endedAt: number | null,
    reps: RepRecord[],
  ): void {
    const record: SessionRecord = {
      id: sessionId,
      startedAt,
      endedAt,
      drillType: 'first_beat_go_no_go',
      repCount: reps.length,
      summary: summarize(reps),
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
    }
    void saveRep(rep)
    const nextReps = [...state.reps, rep]
    set({
      phase: 'feedback',
      feedback: { rep, cue },
      reps: nextReps,
    })
    persistSession(state.sessionId, state.sessionStartedAt, null, nextReps)
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

    start: (overrides, rng) => {
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
      })
      persistSession(sessionId, startedAt, null, [])
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
      const { config, reps } = get()
      if (config.maxReps !== null && reps.length >= config.maxReps) {
        get().stop()
        return
      }
      get().beginRep()
    },

    stop: () => {
      const { sessionId, sessionStartedAt, reps } = get()
      if (sessionId && sessionStartedAt !== null) {
        persistSession(sessionId, sessionStartedAt, Date.now(), reps)
      }
      set({ phase: 'ended', current: null })
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
      })
    },
  }
})

export function getSessionSummary(reps: RepRecord[]) {
  return summarize(reps)
}
