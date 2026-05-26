import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'
import { getDb } from './db'

async function clearSettings() {
  const db = getDb()
  if (!db) return
  await db.settings.clear()
}

describe('settings store', () => {
  beforeEach(async () => {
    await clearSettings()
  })

  it('returns defaults when no row exists', async () => {
    const s = await loadSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips a saved settings record', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      commitKeyCode: 'F12',
      commitKeyLabel: 'F12',
      inputSource: 'pedal',
      rounds: 3,
      workMs: 90_000,
      restMs: 30_000,
      preCueMinMs: 2000,
      preCueMaxMs: 6000,
      penaltyCounterEnabled: true,
    })
    const s = await loadSettings()
    expect(s.commitKeyCode).toBe('F12')
    expect(s.inputSource).toBe('pedal')
    expect(s.rounds).toBe(3)
    expect(s.workMs).toBe(90_000)
    expect(s.penaltyCounterEnabled).toBe(true)
  })

  it('fills in missing fields with defaults', async () => {
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    // simulate a stale row with only a subset of fields written
    await db.settings.put({
      id: 'singleton',
      commitKeyCode: 'Enter',
      commitKeyLabel: 'Enter',
      // intentionally missing other fields
    } as never)
    const s = await loadSettings()
    expect(s.commitKeyCode).toBe('Enter')
    expect(s.rounds).toBe(DEFAULT_SETTINGS.rounds)
    expect(s.preCueMaxMs).toBe(DEFAULT_SETTINGS.preCueMaxMs)
  })
})
