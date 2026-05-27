import Dexie, { type EntityTable } from 'dexie'
import type { RepRecord, SessionRecord } from '../engine/types'
import type { SettingsRecord } from './settings-types'
import type { ProfileRecord } from './profiles'
import type { ClipRecord } from '../clipmode/types'

export class ReactorDB extends Dexie {
  sessions!: EntityTable<SessionRecord, 'id'>
  reps!: EntityTable<RepRecord, 'id'>
  settings!: EntityTable<SettingsRecord, 'id'>
  profiles!: EntityTable<ProfileRecord, 'id'>
  clips!: EntityTable<ClipRecord, 'id'>

  constructor() {
    super('pointfight-reactor')
    this.version(1).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
    })
    this.version(2).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
      settings: 'id',
    })
    this.version(3).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
      settings: 'id',
      profiles: 'id, createdAt',
    })
    // Phase 6.1: clip library. `clipId` index on reps lights up in 6.3 when
    // RepRecord gains the field; pre-v4 reps remain readable and simply
    // never match `where('clipId').equals(...)` queries.
    this.version(4).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId, clipId',
      settings: 'id',
      profiles: 'id, createdAt',
      clips: 'id, importedAt',
    })
  }
}

let _db: ReactorDB | null = null
let _openError: Error | null = null

export function getDb(): ReactorDB | null {
  if (_db) return _db
  if (_openError) return null
  try {
    _db = new ReactorDB()
    return _db
  } catch (err) {
    _openError = err instanceof Error ? err : new Error(String(err))
    return null
  }
}

export function getDbError(): Error | null {
  return _openError
}

export async function saveSession(session: SessionRecord): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await db.sessions.put(session)
  } catch (err) {
    _openError = err instanceof Error ? err : new Error(String(err))
  }
}

export async function saveRep(rep: RepRecord): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await db.reps.put(rep)
  } catch (err) {
    _openError = err instanceof Error ? err : new Error(String(err))
  }
}

export async function listRecentSessions(limit = 20): Promise<SessionRecord[]> {
  const db = getDb()
  if (!db) return []
  try {
    return await db.sessions
      .orderBy('startedAt')
      .reverse()
      .limit(limit)
      .toArray()
  } catch {
    return []
  }
}

/**
 * Bulk-fetch reps for a set of sessionIds, grouped by sessionId. Sessions in
 * `sessionIds` that have no reps still appear in the result with an empty
 * array — callers can rely on Map.get(id) returning [], not undefined.
 */
export async function listRepsForSessions(
  sessionIds: string[],
): Promise<Map<string, RepRecord[]>> {
  const out = new Map<string, RepRecord[]>()
  for (const id of sessionIds) out.set(id, [])
  if (sessionIds.length === 0) return out
  const db = getDb()
  if (!db) return out
  try {
    const reps = await db.reps.where('sessionId').anyOf(sessionIds).toArray()
    for (const r of reps) {
      const list = out.get(r.sessionId)
      if (list) list.push(r)
    }
  } catch {
    /* fall through with whatever was groupable */
  }
  return out
}
