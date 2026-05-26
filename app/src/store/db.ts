import Dexie, { type EntityTable } from 'dexie'
import type { RepRecord, SessionRecord } from '../engine/types'

export class ReactorDB extends Dexie {
  sessions!: EntityTable<SessionRecord, 'id'>
  reps!: EntityTable<RepRecord, 'id'>

  constructor() {
    super('pointfight-reactor')
    this.version(1).stores({
      sessions: 'id, startedAt',
      reps: 'id, sessionId, cueId',
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
