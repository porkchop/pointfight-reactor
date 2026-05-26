import { getDb } from './db'
import { DEFAULT_SETTINGS, type SettingsRecord } from './settings-types'

export { DEFAULT_SETTINGS, type SettingsRecord } from './settings-types'

export async function loadSettings(): Promise<SettingsRecord> {
  const db = getDb()
  if (!db) return DEFAULT_SETTINGS
  try {
    const row = await db.settings.get('singleton')
    if (!row) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...row }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(s: SettingsRecord): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await db.settings.put(s)
  } catch {
    /* ignore — UI will surface load errors on next read */
  }
}
