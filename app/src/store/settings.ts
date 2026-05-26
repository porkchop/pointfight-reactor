import { getDb } from './db'
import {
  DEFAULT_SETTINGS,
  type LegacySettingsFields,
  type SettingsRecord,
} from './settings-types'
import {
  buildDefaultProfile,
  ensureAtLeastOneProfile,
  getProfile,
  listProfiles,
  saveProfile,
  DEFAULT_PROFILE_NAME,
  type ProfileRecord,
} from './profiles'
import type { DrillConfig } from '../engine/types'

export { DEFAULT_SETTINGS, type SettingsRecord } from './settings-types'

export async function loadSettings(): Promise<SettingsRecord> {
  const db = getDb()
  if (!db) return DEFAULT_SETTINGS
  try {
    const row = await db.settings.get('singleton')
    if (!row) return DEFAULT_SETTINGS
    // Strip any legacy drill fields when returning to callers.
    const {
      id,
      commitKeyCode,
      commitKeyLabel,
      inputSource,
      activeProfileId,
      laptopLanIp,
    } = { ...DEFAULT_SETTINGS, ...row }
    return {
      id,
      commitKeyCode,
      commitKeyLabel,
      inputSource,
      activeProfileId,
      laptopLanIp,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(s: SettingsRecord): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    // Only write the slim shape — never re-persist legacy drill fields.
    const {
      id,
      commitKeyCode,
      commitKeyLabel,
      inputSource,
      activeProfileId,
      laptopLanIp,
    } = s
    await db.settings.put({
      id,
      commitKeyCode,
      commitKeyLabel,
      inputSource,
      ...(activeProfileId !== undefined ? { activeProfileId } : {}),
      ...(laptopLanIp !== undefined ? { laptopLanIp } : {}),
    })
  } catch {
    /* ignore */
  }
}

let inFlightActive: Promise<ProfileRecord> | null = null

async function readLegacySettingsOverrides(): Promise<Partial<DrillConfig>> {
  const db = getDb()
  if (!db) return {}
  try {
    const row = (await db.settings.get('singleton')) as
      | (SettingsRecord & LegacySettingsFields)
      | undefined
    if (!row) return {}
    const overrides: Partial<DrillConfig> = {}
    const copyNumber = (k: keyof LegacySettingsFields, target: keyof DrillConfig) => {
      const v = row[k]
      if (typeof v === 'number') (overrides[target] as number) = v
    }
    const copyBool = (k: keyof LegacySettingsFields, target: keyof DrillConfig) => {
      const v = row[k]
      if (typeof v === 'boolean') (overrides[target] as boolean) = v
    }
    copyNumber('preCueMinMs', 'preCueMinMs')
    copyNumber('preCueMaxMs', 'preCueMaxMs')
    copyNumber('rounds', 'rounds')
    copyNumber('workMs', 'workMs')
    copyNumber('restMs', 'restMs')
    copyNumber('perFalseStartPenalty', 'perFalseStartPenalty')
    copyNumber('perHesitationPenalty', 'perHesitationPenalty')
    copyBool('penaltyCounterEnabled', 'penaltyCounterEnabled')
    copyBool('distanceAxisEnabled', 'distanceAxisEnabled')
    copyBool('audioToneEnabled', 'audioToneEnabled')
    copyBool('textOverlayEnabled', 'textOverlayEnabled')
    return overrides
  } catch {
    return {}
  }
}

/**
 * Resolve the user's active drill profile. On first run (or after migrating
 * from Phase 2/3) seeds a Default profile from whatever drill-config-shaped
 * fields the legacy SettingsRecord carried, then persists `activeProfileId`.
 *
 * Concurrent callers share one in-flight promise so we never double-seed under
 * React StrictMode's double-mount.
 */
export function loadActiveProfile(): Promise<ProfileRecord> {
  if (inFlightActive) return inFlightActive
  inFlightActive = (async () => {
    try {
      const settings = await loadSettings()
      if (settings.activeProfileId) {
        const existing = await getProfile(settings.activeProfileId)
        if (existing) return existing
      }
      const existing = await listProfiles()
      if (existing.length > 0) {
        const named =
          existing.find((p) => p.name === DEFAULT_PROFILE_NAME) ?? existing[0]
        await saveSettings({ ...settings, activeProfileId: named.id })
        return named
      }
      const overrides = await readLegacySettingsOverrides()
      const seed = buildDefaultProfile(overrides)
      await saveProfile(seed)
      await saveSettings({ ...settings, activeProfileId: seed.id })
      return seed
    } finally {
      inFlightActive = null
    }
  })()
  return inFlightActive
}

export async function setActiveProfile(id: string): Promise<void> {
  const settings = await loadSettings()
  await saveSettings({ ...settings, activeProfileId: id })
}

export { ensureAtLeastOneProfile }
