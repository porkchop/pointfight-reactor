import { beforeEach, describe, expect, it } from 'vitest'
import { mulberry32 } from '../engine/rng'
import { useSession } from './session'
import { getDb } from './db'

function reset() {
  useSession.getState().reset()
}

async function clearDb() {
  const db = getDb()
  if (!db) return
  await db.reps.clear()
  await db.sessions.clear()
}

describe('useSession store', () => {
  beforeEach(async () => {
    reset()
    await clearDb()
  })

  it('transitions idle → waiting on start with a pre-selected cue', () => {
    useSession.getState().start({}, mulberry32(1))
    const s = useSession.getState()
    expect(s.phase).toBe('waiting')
    expect(s.sessionId).not.toBeNull()
    expect(s.current).not.toBeNull()
    expect(s.current?.cueShownAt).toBeNull()
    expect(s.reps).toEqual([])
  })

  it('press during waiting (pre-cue) records a false_start rep', () => {
    useSession.getState().start({}, mulberry32(2))
    const before = useSession.getState().reps.length
    useSession.getState().recordPress(performance.now())
    const after = useSession.getState()
    expect(after.reps.length).toBe(before + 1)
    expect(after.reps[after.reps.length - 1].result).toBe('false_start')
    expect(after.phase).toBe('feedback')
  })

  it('press after revealCue on a go cue records correct_go with reaction time', () => {
    useSession.getState().start(
      { goCueProbability: 1, hesitationThresholdMs: 600 },
      mulberry32(3),
    )
    useSession.getState().revealCue()
    const cueShownAt = useSession.getState().current?.cueShownAt as number
    useSession.getState().recordPress(cueShownAt + 200)
    const rep = useSession.getState().reps.at(-1)
    expect(rep?.result).toBe('correct_go')
    expect(rep?.reactionMs).toBe(200)
    expect(useSession.getState().phase).toBe('feedback')
  })

  it('finishWindow with no press on a go cue records late', () => {
    useSession.getState().start(
      { goCueProbability: 1 },
      mulberry32(4),
    )
    useSession.getState().revealCue()
    useSession.getState().finishWindow()
    const rep = useSession.getState().reps.at(-1)
    expect(rep?.result).toBe('late')
    expect(rep?.pressedAt).toBeNull()
  })

  it('finishWindow with no press on a no-go cue records correct_no_go', () => {
    useSession.getState().start(
      { goCueProbability: 0 },
      mulberry32(5),
    )
    useSession.getState().revealCue()
    useSession.getState().finishWindow()
    const rep = useSession.getState().reps.at(-1)
    expect(rep?.result).toBe('correct_no_go')
  })

  it('stop ends the drill', () => {
    useSession.getState().start({}, mulberry32(6))
    useSession.getState().stop()
    expect(useSession.getState().phase).toBe('ended')
  })

  it('persists session record incrementally so reps and session row stay in sync', async () => {
    useSession.getState().start(
      { goCueProbability: 1 },
      mulberry32(7),
    )
    const sessionId = useSession.getState().sessionId as string
    useSession.getState().revealCue()
    const cueShownAt = useSession.getState().current?.cueShownAt as number
    useSession.getState().recordPress(cueShownAt + 100)

    await new Promise((r) => setTimeout(r, 0))
    const db = getDb()
    if (!db) throw new Error('db not available in test')
    const stored = await db.sessions.get(sessionId)
    expect(stored?.repCount).toBe(1)
    expect(stored?.summary.correct).toBe(1)
    expect(stored?.endedAt).toBeNull()
  })

  it('acknowledgeFeedback after maxReps ends the drill', () => {
    useSession.getState().start(
      { goCueProbability: 1, maxReps: 1 },
      mulberry32(8),
    )
    useSession.getState().revealCue()
    const cueShownAt = useSession.getState().current?.cueShownAt as number
    useSession.getState().recordPress(cueShownAt + 50)
    useSession.getState().acknowledgeFeedback()
    expect(useSession.getState().phase).toBe('ended')
  })

  it('acknowledgeFeedback transitions to rest when work time is up and more rounds remain', () => {
    useSession.getState().start(
      { goCueProbability: 1, rounds: 2, workMs: 0, restMs: 1000 },
      mulberry32(9),
    )
    useSession.getState().revealCue()
    const cueShownAt = useSession.getState().current?.cueShownAt as number
    useSession.getState().recordPress(cueShownAt + 50)
    useSession.getState().acknowledgeFeedback()
    const s = useSession.getState()
    expect(s.phase).toBe('rest')
    expect(s.restEndAt).not.toBeNull()
    expect(s.roundIndex).toBe(0)
  })

  it('nextRound from rest increments roundIndex and starts new work period', () => {
    useSession.getState().start(
      { goCueProbability: 1, rounds: 3, workMs: 0, restMs: 0 },
      mulberry32(10),
    )
    useSession.getState().revealCue()
    const cueShownAt = useSession.getState().current?.cueShownAt as number
    useSession.getState().recordPress(cueShownAt + 50)
    useSession.getState().acknowledgeFeedback()
    expect(useSession.getState().phase).toBe('rest')

    useSession.getState().nextRound()
    const s = useSession.getState()
    expect(s.roundIndex).toBe(1)
    expect(s.phase).toBe('waiting')
    expect(s.restEndAt).toBeNull()
    expect(s.workEndAt).not.toBeNull()
  })

  it('acknowledgeFeedback after final round ends the drill instead of resting', () => {
    useSession.getState().start(
      { goCueProbability: 1, rounds: 1, workMs: 0, restMs: 1000 },
      mulberry32(11),
    )
    useSession.getState().revealCue()
    const cueShownAt = useSession.getState().current?.cueShownAt as number
    useSession.getState().recordPress(cueShownAt + 50)
    useSession.getState().acknowledgeFeedback()
    expect(useSession.getState().phase).toBe('ended')
  })

  it('stamps roundIndex and inputSource on each rep', () => {
    useSession.getState().start(
      { goCueProbability: 1, rounds: 2, workMs: 0, restMs: 0 },
      mulberry32(12),
      'pedal',
    )
    useSession.getState().revealCue()
    let cueShownAt = useSession.getState().current?.cueShownAt as number
    useSession.getState().recordPress(cueShownAt + 50)
    expect(useSession.getState().reps.at(-1)?.roundIndex).toBe(0)
    expect(useSession.getState().reps.at(-1)?.inputSource).toBe('pedal')

    useSession.getState().acknowledgeFeedback()
    useSession.getState().nextRound()
    useSession.getState().revealCue()
    cueShownAt = useSession.getState().current?.cueShownAt as number
    useSession.getState().recordPress(cueShownAt + 50)
    expect(useSession.getState().reps.at(-1)?.roundIndex).toBe(1)
  })

  it('clearPenalty increments cleared and persists', async () => {
    useSession.getState().start({}, mulberry32(13))
    expect(useSession.getState().cleared).toBe(0)
    useSession.getState().clearPenalty()
    useSession.getState().clearPenalty()
    expect(useSession.getState().cleared).toBe(2)

    await new Promise((r) => setTimeout(r, 0))
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    const sessionId = useSession.getState().sessionId as string
    const stored = await db.sessions.get(sessionId)
    expect(stored?.cleared).toBe(2)
  })
})
