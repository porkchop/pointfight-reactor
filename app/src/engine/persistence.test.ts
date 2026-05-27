import { beforeEach, describe, expect, it } from 'vitest'
import { commitRep } from './persistence'
import { getDb } from '../store/db'
import { CUE_LIBRARY } from '../cues/library'
import type { ClassifyOutput } from './drill'
import type { CueDef } from './types'

async function flush() {
  // commitRep fires `saveRep` synchronously but Dexie resolves on a
  // microtask. A `Promise.resolve()` round-trip is enough to let the put
  // settle before we query the row back.
  await Promise.resolve()
  await Promise.resolve()
}

function findCue(id: string): CueDef {
  const c = CUE_LIBRARY.find((c) => c.id === id)
  if (!c) throw new Error(`unknown cue id: ${id}`)
  return c
}

function classify(
  result: ClassifyOutput['result'],
  reactionMs: number | null = null,
  score = 0,
): ClassifyOutput {
  return { result, reactionMs, score }
}

async function clearDb() {
  const db = getDb()
  if (!db) return
  await db.reps.clear()
}

describe('commitRep', () => {
  beforeEach(async () => {
    await clearDb()
  })

  it('builds a RepRecord with a minted id and the session-level context', async () => {
    const cue = findCue('blitzes')
    const { rep, feedback, effective } = commitRep({
      cue,
      distance: null,
      cueShownAt: 1000,
      pressedAt: 1200,
      classification: classify('correct_go', 200, 1),
      sessionId: 'sess-A',
      roundIndex: 2,
      inputSource: 'keyboard',
    })

    expect(rep.id).toMatch(/^([a-f0-9-]+|rep-)/) // crypto.randomUUID() or fallback
    expect(rep.sessionId).toBe('sess-A')
    expect(rep.cueId).toBe('blitzes')
    expect(rep.isGo).toBe(true)
    expect(rep.result).toBe('correct_go')
    expect(rep.reactionMs).toBe(200)
    expect(rep.score).toBe(1)
    expect(rep.cueShownAt).toBe(1000)
    expect(rep.pressedAt).toBe(1200)
    expect(rep.roundIndex).toBe(2)
    expect(rep.inputSource).toBe('keyboard')
    expect(rep.distance).toBeUndefined()
    expect(rep.clipId).toBeUndefined()
    expect(feedback.rep).toBe(rep)
    expect(feedback.cue).toBe(cue)
    expect(effective.isGo).toBe(true)
    expect(effective.expectedResponse).toBe('jam_entry')
  })

  it('persists the rep via saveRep (db.reps.get returns the same row)', async () => {
    const cue = findCue('steps_in')
    const { rep } = commitRep({
      cue,
      distance: null,
      cueShownAt: 500,
      pressedAt: 800,
      classification: classify('correct_go', 300, 1),
      sessionId: 'sess-persist',
      roundIndex: 0,
      inputSource: 'pedal',
    })

    await flush()
    const db = getDb()
    const stored = await db?.reps.get(rep.id)
    expect(stored?.id).toBe(rep.id)
    expect(stored?.sessionId).toBe('sess-persist')
    expect(stored?.inputSource).toBe('pedal')
  })

  it('omits the distance field when null (Phase 4 invariant: undefined means distance axis disabled)', async () => {
    const cue = findCue('blitzes')
    const { rep } = commitRep({
      cue,
      distance: null,
      cueShownAt: 0,
      pressedAt: null,
      classification: classify('late', null, 0),
      sessionId: 'sess-no-dist',
      roundIndex: 0,
      inputSource: 'keyboard',
    })
    expect('distance' in rep).toBe(false)
  })

  it('writes the distance field when set (Phase 4 distance axis)', async () => {
    const cue = findCue('steps_in')
    const { rep, effective } = commitRep({
      cue,
      distance: 'far',
      cueShownAt: 0,
      pressedAt: null,
      classification: classify('correct_no_go', null, 1),
      sessionId: 'sess-with-dist',
      roundIndex: 0,
      inputSource: 'keyboard',
    })
    expect(rep.distance).toBe('far')
    // resolveCueAtDistance for steps_in @ far → isGo: false
    expect(rep.isGo).toBe(false)
    expect(effective.isGo).toBe(false)
  })

  it('writes the clipId field when set (Phase 6.3 clip-mode rep)', async () => {
    const cue = findCue('blitzes')
    const { rep } = commitRep({
      cue,
      distance: null,
      cueShownAt: 1000,
      pressedAt: 1300,
      classification: classify('correct_go', 300, 1),
      sessionId: 'sess-clip',
      roundIndex: 0,
      inputSource: 'phone',
      clipId: 'clip-xyz',
    })
    expect(rep.clipId).toBe('clip-xyz')
  })

  it('omits the clipId field when undefined (Phase 6.3 back-compat for live mode)', async () => {
    const cue = findCue('blitzes')
    const { rep } = commitRep({
      cue,
      distance: null,
      cueShownAt: 0,
      pressedAt: null,
      classification: classify('late', null, 0),
      sessionId: 'sess-live',
      roundIndex: 0,
      inputSource: 'keyboard',
    })
    expect('clipId' in rep).toBe(false)
  })

  it('mints unique ids across consecutive calls', async () => {
    const cue = findCue('blitzes')
    const c = classify('false_start', null, -1)
    const a = commitRep({
      cue,
      distance: null,
      cueShownAt: 0,
      pressedAt: -10,
      classification: c,
      sessionId: 'x',
      roundIndex: 0,
      inputSource: 'keyboard',
    })
    const b = commitRep({
      cue,
      distance: null,
      cueShownAt: 0,
      pressedAt: -10,
      classification: c,
      sessionId: 'x',
      roundIndex: 0,
      inputSource: 'keyboard',
    })
    expect(a.rep.id).not.toBe(b.rep.id)
  })
})
