import type { InputSource } from '../engine/types'

export interface SettingsRecord {
  id: 'singleton'
  commitKeyCode: string
  commitKeyLabel: string
  inputSource: InputSource
  rounds: number
  workMs: number
  restMs: number
  preCueMinMs: number
  preCueMaxMs: number
  penaltyCounterEnabled: boolean
  perFalseStartPenalty: number
  perHesitationPenalty: number
}

export const DEFAULT_SETTINGS: SettingsRecord = {
  id: 'singleton',
  commitKeyCode: 'Space',
  commitKeyLabel: 'Space',
  inputSource: 'keyboard',
  rounds: 5,
  workMs: 120_000,
  restMs: 60_000,
  preCueMinMs: 1500,
  preCueMaxMs: 4000,
  penaltyCounterEnabled: false,
  perFalseStartPenalty: 1,
  perHesitationPenalty: 1,
}
