import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../engine/rng'
import { getDb } from '../store/db'
import * as persistence from '../engine/persistence'
import { useClipRunner, selectTaggedClips } from './runner'
import type { ClipRecord } from './types'

function makeClip(over: Partial<ClipRecord> = {}): ClipRecord {
  return {
    id: over.id ?? 'clip-1',
    name: over.name ?? 'clip-1.mp4',
    mimeType: 'video/mp4',
    durationMs: over.durationMs ?? 4000,
    sizeBytes: 1024,
    importedAt: over.importedAt ?? 1000,
    blob: new Blob(['x'], { type: 'video/mp4' }),
    cueId: over.cueId,
    cueAtMs: over.cueAtMs,
  }
}

function taggedClip(id: string, cueId: ClipRecord['cueId'], cueAtMs: number) {
  return makeClip({ id, cueId, cueAtMs })
}

async function clearDb() {
  const db = getDb()
  if (!db) return
  await db.reps.clear()
  await db.sessions.clear()
}

function flush() {
  return Promise.resolve()
}

describe('selectTaggedClips', () => {
  it('keeps clips with both cueId and cueAtMs set', () => {
    const tagged = taggedClip('a', 'blitzes', 1000)
    const partial = makeClip({ id: 'b', cueId: 'blitzes' /* no cueAtMs */ })
    const untagged = makeClip({ id: 'c' })
    expect(selectTaggedClips([tagged, partial, untagged])).toEqual([tagged])
  })

  it('returns an empty array when no clips are tagged', () => {
    expect(selectTaggedClips([makeClip(), makeClip({ id: 'x' })])).toEqual([])
  })
})

describe('useClipRunner', () => {
  beforeEach(async () => {
    useClipRunner.getState().reset()
    await clearDb()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('start with an empty tagged pool is a no-op (stays idle)', () => {
    useClipRunner.getState().start([makeClip()], {}, mulberry32(1))
    const s = useClipRunner.getState()
    expect(s.phase).toBe('idle')
    expect(s.sessionId).toBeNull()
  })

  it('start picks an initial clip and transitions to precue', () => {
    const clips = [
      taggedClip('a', 'blitzes', 500),
      taggedClip('b', 'steps_in', 800),
    ]
    useClipRunner.getState().start(clips, { maxReps: 5 }, mulberry32(1))
    const s = useClipRunner.getState()
    expect(s.phase).toBe('precue')
    expect(s.sessionId).not.toBeNull()
    expect(s.currentClip).not.toBeNull()
    expect(['a', 'b']).toContain(s.currentClip?.id)
    expect(s.config.maxReps).toBe(5)
    expect(s.reps).toEqual([])
  })

  it('markClipStarted + markCueShown advance phase to "showing" with cueShownAt set', () => {
    useClipRunner
      .getState()
      .start([taggedClip('a', 'blitzes', 500)], {}, mulberry32(1))
    useClipRunner.getState().markClipStarted(10_000)
    useClipRunner.getState().markCueShown(10_500)
    const s = useClipRunner.getState()
    expect(s.phase).toBe('showing')
    expect(s.cueShownAt).toBe(10_500)
    expect(s.clipStartedAt).toBe(10_000)
  })

  it('recordPress within hesitation threshold on a go cue → correct_go with clipId', () => {
    useClipRunner
      .getState()
      .start(
        [taggedClip('alpha', 'blitzes', 500)],
        { hesitationThresholdMs: 600 },
        mulberry32(1),
      )
    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().markCueShown(1000)
    useClipRunner.getState().recordPress(1300)
    const s = useClipRunner.getState()
    const rep = s.reps.at(-1)
    expect(s.phase).toBe('feedback')
    expect(rep?.result).toBe('correct_go')
    expect(rep?.reactionMs).toBe(300)
    expect(rep?.clipId).toBe('alpha')
    expect(rep?.inputSource).toBe('keyboard')
  })

  it('recordPress before cue (during precue) records a false_start with clipId', () => {
    useClipRunner
      .getState()
      .start([taggedClip('alpha', 'blitzes', 500)], {}, mulberry32(1))
    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().recordPress(200) // before cue
    const s = useClipRunner.getState()
    const rep = s.reps.at(-1)
    expect(rep?.result).toBe('false_start')
    expect(rep?.clipId).toBe('alpha')
    expect(s.phase).toBe('feedback')
  })

  it('finishWindow with no press on a go cue records late with clipId', () => {
    useClipRunner
      .getState()
      .start([taggedClip('alpha', 'blitzes', 500)], {}, mulberry32(1))
    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().markCueShown(1000)
    useClipRunner.getState().finishWindow()
    const rep = useClipRunner.getState().reps.at(-1)
    expect(rep?.result).toBe('late')
    expect(rep?.clipId).toBe('alpha')
  })

  it('acknowledgeFeedback after a rep selects the next clip', () => {
    const clips = [
      taggedClip('a', 'blitzes', 500),
      taggedClip('b', 'steps_in', 500),
    ]
    useClipRunner.getState().start(clips, {}, mulberry32(1))
    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().markCueShown(1000)
    useClipRunner.getState().recordPress(1300)
    const first = useClipRunner.getState().currentClip?.id
    useClipRunner.getState().acknowledgeFeedback()
    const s = useClipRunner.getState()
    expect(s.phase).toBe('precue')
    expect(s.currentClip?.id).not.toBe(first) // no-immediate-repeat
  })

  it('acknowledgeFeedback at maxReps ends the session and persists with mode="clip"', async () => {
    useClipRunner
      .getState()
      .start(
        [taggedClip('a', 'blitzes', 500), taggedClip('b', 'steps_in', 500)],
        { maxReps: 1 },
        mulberry32(1),
      )
    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().markCueShown(1000)
    useClipRunner.getState().recordPress(1300)
    useClipRunner.getState().acknowledgeFeedback()
    const s = useClipRunner.getState()
    expect(s.phase).toBe('ended')
    await flush()
    await flush()
    const db = getDb()
    const sessionId = s.sessionId
    if (!db || !sessionId) throw new Error('db/session unavailable')
    const stored = await db.sessions.get(sessionId)
    expect(stored?.mode).toBe('clip')
    expect(stored?.endedAt).not.toBeNull()
    expect(stored?.repCount).toBe(1)
  })

  it('stop() persists the session with mode="clip" and endedAt set', async () => {
    useClipRunner
      .getState()
      .start([taggedClip('a', 'blitzes', 500)], {}, mulberry32(1))
    useClipRunner.getState().stop()
    await flush()
    await flush()
    const sessionId = useClipRunner.getState().sessionId
    if (!sessionId) throw new Error('sessionId missing')
    const db = getDb()
    const stored = await db?.sessions.get(sessionId)
    expect(stored?.mode).toBe('clip')
    expect(stored?.endedAt).not.toBeNull()
  })

  it('bumps playSeq on every selectNextClip, including back-to-back single-clip pool (code-reviewer B1 regression)', () => {
    useClipRunner
      .getState()
      .start([taggedClip('only', 'blitzes', 500)], {}, mulberry32(1))
    const seqAfterStart = useClipRunner.getState().playSeq
    expect(seqAfterStart).toBe(1)
    expect(useClipRunner.getState().currentClip?.id).toBe('only')

    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().markCueShown(1000)
    useClipRunner.getState().recordPress(1200)
    useClipRunner.getState().acknowledgeFeedback()
    // Same clip selected again (only one in pool), but playSeq bumped so
    // the screen's rewind+play effect re-fires.
    expect(useClipRunner.getState().playSeq).toBe(2)
    expect(useClipRunner.getState().currentClip?.id).toBe('only')
  })

  it('selectNextClip is a no-op when called from precue or showing (code-reviewer S4 guard)', () => {
    const clips = [
      taggedClip('a', 'blitzes', 500),
      taggedClip('b', 'steps_in', 500),
    ]
    useClipRunner.getState().start(clips, {}, mulberry32(1))
    const firstId = useClipRunner.getState().currentClip?.id
    const firstSeq = useClipRunner.getState().playSeq
    // We are in 'precue' — selectNextClip must NOT advance.
    useClipRunner.getState().selectNextClip()
    expect(useClipRunner.getState().currentClip?.id).toBe(firstId)
    expect(useClipRunner.getState().playSeq).toBe(firstSeq)

    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().markCueShown(1000)
    // Now in 'showing' — still a no-op.
    useClipRunner.getState().selectNextClip()
    expect(useClipRunner.getState().currentClip?.id).toBe(firstId)
    expect(useClipRunner.getState().playSeq).toBe(firstSeq)
  })

  it('routes recordPress through engine/persistence.commitRep (code-reviewer B4 wire test)', () => {
    const spy = vi.spyOn(persistence, 'commitRep')
    useClipRunner
      .getState()
      .start([taggedClip('a', 'blitzes', 500)], {}, mulberry32(1))
    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().markCueShown(1000)
    useClipRunner.getState().recordPress(1200)
    expect(spy).toHaveBeenCalledTimes(1)
    const callArg = spy.mock.calls[0][0]
    expect(callArg.clipId).toBe('a')
    expect(callArg.sessionId).not.toBeNull()
  })

  it('routes session persistence through engine/persistence.persistSessionRecord (code-reviewer B3 wire test)', () => {
    const spy = vi.spyOn(persistence, 'persistSessionRecord')
    useClipRunner
      .getState()
      .start([taggedClip('a', 'blitzes', 500)], {}, mulberry32(1))
    expect(spy).toHaveBeenCalled()
    const firstArg = spy.mock.calls[0][0]
    expect(firstArg.mode).toBe('clip')
  })

  it('records inputSource onto each rep (Phase 6.3 cross-cut for phone/pedal/keyboard)', () => {
    useClipRunner
      .getState()
      .start(
        [taggedClip('a', 'blitzes', 500)],
        {},
        mulberry32(1),
        'phone',
      )
    useClipRunner.getState().markClipStarted(0)
    useClipRunner.getState().markCueShown(1000)
    useClipRunner.getState().recordPress(1200)
    expect(useClipRunner.getState().reps.at(-1)?.inputSource).toBe('phone')
  })
})
