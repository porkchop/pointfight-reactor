import { create } from 'zustand'
import { CUE_LIBRARY } from '../cues/library'
import {
  classifyPreCuePress,
  classifyRep,
} from '../engine/drill'
import {
  commitRep,
  mintSessionId,
  persistSessionRecord,
} from '../engine/persistence'
import { defaultRng, type RNG } from '../engine/rng'
import {
  DEFAULT_DRILL_CONFIG,
  type CueDef,
  type DrillConfig,
  type InputSource,
  type RepRecord,
} from '../engine/types'
import { pickNextClip } from './random'
import type { ClipRecord } from './types'

export type ClipPhase =
  | 'idle'
  | 'precue'
  | 'showing'
  | 'feedback'
  | 'ended'

export interface ClipFeedbackState {
  rep: RepRecord
  cue: CueDef
  clip: ClipRecord
}

interface ClipRunnerState {
  phase: ClipPhase
  sessionId: string | null
  sessionStartedAt: number | null
  config: DrillConfig
  rng: RNG
  inputSource: InputSource

  /** Tagged clips selected for this session (cueId + cueAtMs both set). */
  pool: ClipRecord[]
  currentClip: ClipRecord | null
  previousClipId: string | null
  /**
   * Monotonic counter incremented on every `selectNextClip` call. The
   * `ClipDrillScreen` keys its rewind/play effect on `playSeq` so that
   * a single-clip pool still triggers rewind + play() on each rep —
   * closes code-reviewer B1 (effect missed re-firing when the same
   * `currentClip` reference was selected twice).
   */
  playSeq: number
  /** performance.now() when the current clip's <video> reported `playing`. */
  clipStartedAt: number | null
  /** performance.now() of the cue-shown moment (set by requestVideoFrameCallback). */
  cueShownAt: number | null

  reps: RepRecord[]
  feedback: ClipFeedbackState | null
  persistError: string | null

  start: (
    pool: ClipRecord[],
    overrides?: Partial<DrillConfig>,
    rng?: RNG,
    inputSource?: InputSource,
  ) => void
  selectNextClip: () => void
  markClipStarted: (at: number) => void
  markCueShown: (at: number) => void
  recordPress: (at: number) => void
  finishWindow: () => void
  acknowledgeFeedback: () => void
  stop: () => void
  reset: () => void
}

function findCue(id: ClipRecord['cueId']): CueDef | null {
  if (id === undefined) return null
  return CUE_LIBRARY.find((c) => c.id === id) ?? null
}

/** Tagged clips only (cueId AND cueAtMs both set). Excludes "needs tag" rows. */
export function selectTaggedClips(clips: ClipRecord[]): ClipRecord[] {
  return clips.filter((c) => c.cueId !== undefined && c.cueAtMs !== undefined)
}

export const useClipRunner = create<ClipRunnerState>((set, get) => {
  function persistSession(endedAt: number | null) {
    const state = get()
    if (!state.sessionId || state.sessionStartedAt === null) return
    // `cleared` + `penaltyCounterEnabled` are live-mode-only concepts
    // (workMs/restMs rounds + clear-list penalty math); clip-mode never
    // builds penalty reps so both are hardcoded false/0 here.
    persistSessionRecord(
      {
        sessionId: state.sessionId,
        startedAt: state.sessionStartedAt,
        endedAt,
        reps: state.reps,
        inputSource: state.inputSource,
        config: state.config,
        cleared: 0,
        penaltyCounterEnabled: false,
        mode: 'clip',
      },
      (err) => set({ persistError: err.message }),
    )
  }

  function commit(
    pressedAt: number | null,
    classification: ReturnType<typeof classifyRep>,
  ) {
    const state = get()
    const { currentClip, sessionId, cueShownAt } = state
    if (!sessionId || !currentClip || cueShownAt === null) return
    const cue = findCue(currentClip.cueId)
    if (!cue) return
    const { rep } = commitRep({
      cue,
      distance: null,
      cueShownAt,
      pressedAt,
      classification,
      sessionId,
      // Clip mode has no rounds concept (the video itself is the
      // pre-cue interval); `roundIndex: 0` keeps `RepRecord.roundIndex`
      // a valid non-null number for Phase-5 analytics consumers.
      roundIndex: 0,
      inputSource: state.inputSource,
      clipId: currentClip.id,
    })
    set({
      phase: 'feedback',
      feedback: { rep, cue, clip: currentClip },
      reps: [...state.reps, rep],
    })
    persistSession(null)
  }

  return {
    phase: 'idle',
    sessionId: null,
    sessionStartedAt: null,
    config: DEFAULT_DRILL_CONFIG,
    rng: defaultRng,
    inputSource: 'keyboard',
    pool: [],
    currentClip: null,
    previousClipId: null,
    playSeq: 0,
    clipStartedAt: null,
    cueShownAt: null,
    reps: [],
    feedback: null,
    persistError: null,

    start: (pool, overrides, rng, inputSource) => {
      const tagged = selectTaggedClips(pool)
      if (tagged.length === 0) return
      const config = { ...DEFAULT_DRILL_CONFIG, ...overrides }
      const sessionId = mintSessionId()
      set({
        phase: 'idle',
        sessionId,
        sessionStartedAt: Date.now(),
        config,
        rng: rng ?? defaultRng,
        inputSource: inputSource ?? 'keyboard',
        pool: tagged,
        currentClip: null,
        previousClipId: null,
        playSeq: 0,
        clipStartedAt: null,
        cueShownAt: null,
        reps: [],
        feedback: null,
        persistError: null,
      })
      persistSession(null)
      get().selectNextClip()
    },

    selectNextClip: () => {
      const state = get()
      const { pool, previousClipId, rng, phase, playSeq } = state
      // Defensive guard: only valid from `idle` (initial) or `feedback`
      // (between reps). Calling from `precue`/`showing` would clobber the
      // in-flight rep — see code-reviewer S4.
      if (phase !== 'idle' && phase !== 'feedback') return
      if (pool.length === 0) return
      const ids = pool.map((c) => c.id)
      const nextId = pickNextClip(rng, ids, previousClipId)
      const next = pool.find((c) => c.id === nextId)
      if (!next) return
      set({
        phase: 'precue',
        currentClip: next,
        previousClipId: nextId,
        playSeq: playSeq + 1,
        clipStartedAt: null,
        cueShownAt: null,
        feedback: null,
      })
    },

    markClipStarted: (at) => {
      const { phase } = get()
      if (phase !== 'precue') return
      set({ clipStartedAt: at })
    },

    markCueShown: (at) => {
      const { phase, currentClip } = get()
      if (phase !== 'precue' || !currentClip) return
      set({ phase: 'showing', cueShownAt: at })
    },

    recordPress: (at) => {
      const { phase, currentClip, cueShownAt, config } = get()
      if (!currentClip) return
      const cue = findCue(currentClip.cueId)
      if (!cue) return

      if (phase === 'precue') {
        // Pre-cue press → false start. cueShownAt is still null; use the
        // press timestamp as the synthetic cue moment so the rep carries a
        // valid number and the analytics layer never sees nulls.
        set({ cueShownAt: at })
        commit(at, classifyPreCuePress(config.scoreWeights))
        return
      }
      if (phase !== 'showing' || cueShownAt === null) return
      const classification = classifyRep({
        isGo: cue.isGo,
        cueShownAt,
        pressedAt: at,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
        lateThresholdMs: config.lateThresholdMs,
        scoreWeights: config.scoreWeights,
      })
      commit(at, classification)
    },

    finishWindow: () => {
      const { phase, currentClip, cueShownAt, config } = get()
      if (phase !== 'showing' || !currentClip || cueShownAt === null) return
      const cue = findCue(currentClip.cueId)
      if (!cue) return
      const classification = classifyRep({
        isGo: cue.isGo,
        cueShownAt,
        pressedAt: null,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
        lateThresholdMs: config.lateThresholdMs,
        scoreWeights: config.scoreWeights,
      })
      commit(null, classification)
    },

    acknowledgeFeedback: () => {
      const { phase, config, reps } = get()
      if (phase !== 'feedback') return
      if (config.maxReps !== null && reps.length >= config.maxReps) {
        get().stop()
        return
      }
      get().selectNextClip()
    },

    stop: () => {
      persistSession(Date.now())
      set({
        phase: 'ended',
        currentClip: null,
        clipStartedAt: null,
        cueShownAt: null,
      })
    },

    reset: () => {
      set({
        phase: 'idle',
        sessionId: null,
        sessionStartedAt: null,
        pool: [],
        currentClip: null,
        previousClipId: null,
        playSeq: 0,
        clipStartedAt: null,
        cueShownAt: null,
        reps: [],
        feedback: null,
        persistError: null,
      })
    },
  }
})
