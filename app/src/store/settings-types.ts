import type { InputSource } from '../engine/types'

export interface SettingsRecord {
  id: 'singleton'
  commitKeyCode: string
  commitKeyLabel: string
  inputSource: InputSource
  activeProfileId?: string
}

export const DEFAULT_SETTINGS: SettingsRecord = {
  id: 'singleton',
  commitKeyCode: 'Space',
  commitKeyLabel: 'Space',
  inputSource: 'keyboard',
}

/**
 * Phase 2/3 `SettingsRecord` rows carried the drill-config fields directly.
 * Phase 4 splits them into `ProfileRecord.config`. This type names the legacy
 * shape so the migration in `loadActiveProfile` can read them once safely.
 */
export interface LegacySettingsFields {
  preCueMinMs?: number
  preCueMaxMs?: number
  rounds?: number
  workMs?: number
  restMs?: number
  penaltyCounterEnabled?: boolean
  perFalseStartPenalty?: number
  perHesitationPenalty?: number
  distanceAxisEnabled?: boolean
  audioToneEnabled?: boolean
  textOverlayEnabled?: boolean
}
