import { getDb } from './db'
import { DEFAULT_DRILL_CONFIG, type DrillConfig } from '../engine/types'

export interface ProfileRecord {
  id: string
  name: string
  config: DrillConfig
  createdAt: number
  updatedAt: number
}

export const DEFAULT_PROFILE_NAME = 'Default'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `prof-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildDefaultProfile(
  overrides?: Partial<DrillConfig>,
): ProfileRecord {
  const now = Date.now()
  return {
    id: newId(),
    name: DEFAULT_PROFILE_NAME,
    config: { ...DEFAULT_DRILL_CONFIG, ...overrides },
    createdAt: now,
    updatedAt: now,
  }
}

export async function listProfiles(): Promise<ProfileRecord[]> {
  const db = getDb()
  if (!db) return []
  try {
    return await db.profiles.orderBy('createdAt').toArray()
  } catch {
    return []
  }
}

export async function getProfile(id: string): Promise<ProfileRecord | null> {
  const db = getDb()
  if (!db) return null
  try {
    return (await db.profiles.get(id)) ?? null
  } catch {
    return null
  }
}

export async function saveProfile(profile: ProfileRecord): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await db.profiles.put({ ...profile, updatedAt: Date.now() })
  } catch {
    /* ignore */
  }
}

export async function deleteProfile(id: string): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await db.profiles.delete(id)
  } catch {
    /* ignore */
  }
}

export async function ensureAtLeastOneProfile(
  seedFromOverrides?: Partial<DrillConfig>,
): Promise<ProfileRecord> {
  const existing = await listProfiles()
  if (existing.length > 0) return existing[0]
  const seed = buildDefaultProfile(seedFromOverrides)
  await saveProfile(seed)
  return seed
}
