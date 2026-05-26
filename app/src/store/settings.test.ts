import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  loadActiveProfile,
  loadSettings,
  saveSettings,
} from './settings'
import { getDb } from './db'

async function clearAll() {
  const db = getDb()
  if (!db) return
  await db.settings.clear()
  await db.profiles.clear()
}

describe('settings store', () => {
  beforeEach(async () => {
    await clearAll()
  })

  it('returns defaults when no row exists', async () => {
    const s = await loadSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips the slim Phase 4 settings shape', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      commitKeyCode: 'F12',
      commitKeyLabel: 'F12',
      inputSource: 'pedal',
      activeProfileId: 'prof-abc',
    })
    const s = await loadSettings()
    expect(s.commitKeyCode).toBe('F12')
    expect(s.inputSource).toBe('pedal')
    expect(s.activeProfileId).toBe('prof-abc')
  })

  it('fills in missing fields with defaults', async () => {
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    await db.settings.put({
      id: 'singleton',
      commitKeyCode: 'Enter',
      commitKeyLabel: 'Enter',
    } as never)
    const s = await loadSettings()
    expect(s.commitKeyCode).toBe('Enter')
    expect(s.inputSource).toBe(DEFAULT_SETTINGS.inputSource)
  })

  it('strips legacy Phase 2/3 drill fields when reading and writing', async () => {
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    // Simulate a stale Phase 3 row that carried drill-config fields directly.
    await db.settings.put({
      id: 'singleton',
      commitKeyCode: 'Space',
      commitKeyLabel: 'Space',
      inputSource: 'keyboard',
      rounds: 9,
      workMs: 90_000,
      restMs: 15_000,
      preCueMinMs: 2000,
      preCueMaxMs: 6000,
      penaltyCounterEnabled: true,
      distanceAxisEnabled: true,
    } as never)
    const s = await loadSettings()
    // Slim shape — legacy fields are not surfaced.
    expect((s as unknown as { rounds?: number }).rounds).toBeUndefined()
    expect((s as unknown as { workMs?: number }).workMs).toBeUndefined()
  })

  it('round-trips the optional Phase 2b.1 laptopLanIp field', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      laptopLanIp: '192.168.1.42',
    })
    const s = await loadSettings()
    expect(s.laptopLanIp).toBe('192.168.1.42')
  })

  it('migrates legacy drill fields into a seeded Default profile on first run', async () => {
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    await db.settings.put({
      id: 'singleton',
      commitKeyCode: 'Space',
      commitKeyLabel: 'Space',
      inputSource: 'keyboard',
      rounds: 9,
      workMs: 45_000,
      restMs: 5_000,
      distanceAxisEnabled: true,
    } as never)
    const profile = await loadActiveProfile()
    expect(profile.name).toBe('Default')
    expect(profile.config.rounds).toBe(9)
    expect(profile.config.workMs).toBe(45_000)
    expect(profile.config.distanceAxisEnabled).toBe(true)
    const settings = await loadSettings()
    expect(settings.activeProfileId).toBe(profile.id)
  })
})
