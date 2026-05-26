import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildDefaultProfile,
  deleteProfile,
  ensureAtLeastOneProfile,
  getProfile,
  listProfiles,
  saveProfile,
} from './profiles'
import { loadActiveProfile, setActiveProfile, loadSettings } from './settings'
import { getDb } from './db'
import { DEFAULT_DRILL_CONFIG } from '../engine/types'

async function clearAll() {
  const db = getDb()
  if (!db) return
  await db.profiles.clear()
  await db.settings.clear()
}

describe('profiles store', () => {
  beforeEach(async () => {
    await clearAll()
  })

  it('round-trips a saved profile', async () => {
    const p = buildDefaultProfile({ rounds: 7, lateThresholdMs: 700 })
    await saveProfile(p)
    const got = await getProfile(p.id)
    expect(got?.name).toBe(p.name)
    expect(got?.config.rounds).toBe(7)
    expect(got?.config.lateThresholdMs).toBe(700)
  })

  it('ensureAtLeastOneProfile creates a default when empty', async () => {
    const before = await listProfiles()
    expect(before).toHaveLength(0)
    const seeded = await ensureAtLeastOneProfile()
    expect(seeded.name).toBe('Default')
    const after = await listProfiles()
    expect(after).toHaveLength(1)
  })

  it('ensureAtLeastOneProfile is idempotent', async () => {
    const first = await ensureAtLeastOneProfile()
    const second = await ensureAtLeastOneProfile()
    expect(second.id).toBe(first.id)
    const all = await listProfiles()
    expect(all).toHaveLength(1)
  })

  it('deleteProfile removes a profile', async () => {
    const p = buildDefaultProfile()
    await saveProfile(p)
    await deleteProfile(p.id)
    expect(await getProfile(p.id)).toBeNull()
  })

  it('round-trips a phoneCalibration field on the profile config', async () => {
    const p = buildDefaultProfile({
      phoneCalibration: { thresholdG: 1.55, calibratedAt: 1_700_000_000_000 },
    })
    await saveProfile(p)
    const got = await getProfile(p.id)
    expect(got?.config.phoneCalibration?.thresholdG).toBeCloseTo(1.55, 6)
    expect(got?.config.phoneCalibration?.calibratedAt).toBe(1_700_000_000_000)
  })

  it('overwrites the prior phoneCalibration on re-save', async () => {
    const p = buildDefaultProfile({
      phoneCalibration: { thresholdG: 1.4, calibratedAt: 1 },
    })
    await saveProfile(p)
    await saveProfile({
      ...p,
      config: {
        ...p.config,
        phoneCalibration: { thresholdG: 2.0, calibratedAt: 2 },
      },
    })
    const got = await getProfile(p.id)
    expect(got?.config.phoneCalibration?.thresholdG).toBeCloseTo(2.0, 6)
    expect(got?.config.phoneCalibration?.calibratedAt).toBe(2)
  })
})

describe('settings + active profile', () => {
  beforeEach(async () => {
    await clearAll()
  })

  it('loadActiveProfile seeds a default on first run and persists activeProfileId', async () => {
    const profile = await loadActiveProfile()
    expect(profile.config.rounds).toBe(DEFAULT_DRILL_CONFIG.rounds)
    const settings = await loadSettings()
    expect(settings.activeProfileId).toBe(profile.id)
  })

  it('setActiveProfile switches the active profile id', async () => {
    const a = buildDefaultProfile()
    const b = { ...buildDefaultProfile(), name: 'Sparring' }
    await saveProfile(a)
    await saveProfile(b)
    await setActiveProfile(b.id)
    const settings = await loadSettings()
    expect(settings.activeProfileId).toBe(b.id)
    const loaded = await loadActiveProfile()
    expect(loaded.id).toBe(b.id)
  })
})
