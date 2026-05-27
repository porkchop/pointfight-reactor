import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { getDb, listRepsForSessions, saveRep, saveSession } from './db'
import type { RepRecord, SessionRecord } from '../engine/types'

async function clear() {
  const db = getDb()
  if (!db) return
  await db.reps.clear()
  await db.sessions.clear()
}

function makeSession(id: string, startedAt: number): SessionRecord {
  return {
    id,
    startedAt,
    endedAt: startedAt + 1000,
    drillType: 'first_beat_go_no_go',
    repCount: 0,
    summary: {
      reps: 0,
      correct: 0,
      falseStarts: 0,
      lateMisses: 0,
      hesitations: 0,
      score: 0,
      avgReactionMs: null,
    },
  }
}

function makeRep(id: string, sessionId: string): RepRecord {
  return {
    id,
    sessionId,
    cueId: 'steps_in',
    isGo: true,
    result: 'correct_go',
    reactionMs: 300,
    score: 1,
    cueShownAt: 0,
    pressedAt: 0,
    roundIndex: 0,
    inputSource: 'keyboard',
  }
}

describe('listRepsForSessions', () => {
  beforeEach(async () => {
    await clear()
  })

  it('groups reps by sessionId for the supplied IDs', async () => {
    await saveSession(makeSession('s1', 1000))
    await saveSession(makeSession('s2', 2000))
    await saveRep(makeRep('r1', 's1'))
    await saveRep(makeRep('r2', 's1'))
    await saveRep(makeRep('r3', 's2'))

    const map = await listRepsForSessions(['s1', 's2'])
    expect(map.get('s1')?.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(map.get('s2')?.map((r) => r.id)).toEqual(['r3'])
  })

  it('returns an empty array (not undefined) for a sessionId with no reps', async () => {
    await saveSession(makeSession('empty', 1000))
    const map = await listRepsForSessions(['empty'])
    expect(map.get('empty')).toEqual([])
  })

  it('returns an empty map when given no sessionIds', async () => {
    const map = await listRepsForSessions([])
    expect(map.size).toBe(0)
  })

  it('does not include reps from sessions outside the requested set', async () => {
    await saveRep(makeRep('r1', 'wanted'))
    await saveRep(makeRep('r2', 'other'))
    const map = await listRepsForSessions(['wanted'])
    expect(map.get('wanted')?.map((r) => r.id)).toEqual(['r1'])
    expect(map.has('other')).toBe(false)
  })
})

describe('Dexie v3 → v4 upgrade', () => {
  // Each test uses a unique DB name so fake-indexeddb's shared state does not
  // collide with the main ReactorDB or with other upgrade-test runs.
  function makeName(suffix: string): string {
    return `pointfight-upgrade-test-${suffix}-${Math.random().toString(36).slice(2)}`
  }

  it('preserves v3 reps after opening at v4 with the new clips table', async () => {
    const name = makeName('preserves-reps')

    const dbV3 = new Dexie(name)
    dbV3.version(1).stores({ sessions: 'id, startedAt', reps: 'id, sessionId, cueId' })
    dbV3.version(2).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
      settings: 'id',
    })
    dbV3.version(3).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
      settings: 'id',
      profiles: 'id, createdAt',
    })
    await dbV3.open()
    await dbV3.table('reps').put({
      id: 'legacy-rep',
      sessionId: 'legacy-session',
      cueId: 'steps_in',
      isGo: true,
      result: 'correct_go',
      reactionMs: 300,
      score: 1,
      cueShownAt: 0,
      pressedAt: 0,
      roundIndex: 0,
      inputSource: 'keyboard',
    })
    dbV3.close()

    const dbV4 = new Dexie(name)
    dbV4.version(1).stores({ sessions: 'id, startedAt', reps: 'id, sessionId, cueId' })
    dbV4.version(2).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
      settings: 'id',
    })
    dbV4.version(3).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
      settings: 'id',
      profiles: 'id, createdAt',
    })
    dbV4.version(4).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId, clipId',
      settings: 'id',
      profiles: 'id, createdAt',
      clips: 'id, importedAt',
    })
    await dbV4.open()

    const recovered = await dbV4.table('reps').get('legacy-rep')
    expect(recovered).toBeDefined()
    expect(recovered?.cueId).toBe('steps_in')

    // The new clipId index is empty for pre-v4 reps.
    const byClip = await dbV4.table('reps').where('clipId').equals('any-clip-id').toArray()
    expect(byClip).toEqual([])

    dbV4.close()
    await Dexie.delete(name)
  })

  it('opens an empty v4 clips table on a fresh database', async () => {
    const name = makeName('fresh-clips')
    const db = new Dexie(name)
    db.version(1).stores({ sessions: 'id, startedAt', reps: 'id, sessionId, cueId' })
    db.version(2).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
      settings: 'id',
    })
    db.version(3).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
      settings: 'id',
      profiles: 'id, createdAt',
    })
    db.version(4).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId, clipId',
      settings: 'id',
      profiles: 'id, createdAt',
      clips: 'id, importedAt',
    })
    await db.open()

    expect(await db.table('clips').count()).toBe(0)

    db.close()
    await Dexie.delete(name)
  })
})
