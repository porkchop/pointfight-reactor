export type PhoneMessage =
  | { type: 'commit'; t: number }
  | { type: 'ping'; t: number }
  | { type: 'sample'; t: number; peakG: number }
  | {
      type: 'config'
      thresholdG: number
      debounceMs: number
      mode: 'armed' | 'calibrating'
    }

const SCALAR_T_TYPES = new Set<PhoneMessage['type']>(['commit', 'ping'])
const CONFIG_MODES = new Set<'armed' | 'calibrating'>(['armed', 'calibrating'])

export function encodePhoneMessage(msg: PhoneMessage): string {
  return JSON.stringify(msg)
}

export function decodePhoneMessage(raw: string): PhoneMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return isPhoneMessage(parsed) ? parsed : null
}

export function isPhoneMessage(v: unknown): v is PhoneMessage {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.type !== 'string') return false
  if (SCALAR_T_TYPES.has(o.type as PhoneMessage['type'])) {
    return Number.isFinite(o.t)
  }
  if (o.type === 'sample') {
    return Number.isFinite(o.t) && Number.isFinite(o.peakG)
  }
  if (o.type === 'config') {
    // Reject NaN / Infinity / negative-or-zero threshold so a buggy or
    // hostile peer cannot silently disable the commit threshold by
    // pushing { thresholdG: 0 } past the type guard. LAN-trust per
    // decision-memo §B1, but the check is free.
    return (
      Number.isFinite(o.thresholdG) &&
      typeof o.thresholdG === 'number' &&
      o.thresholdG > 0 &&
      Number.isFinite(o.debounceMs) &&
      typeof o.debounceMs === 'number' &&
      o.debounceMs >= 0 &&
      typeof o.mode === 'string' &&
      CONFIG_MODES.has(o.mode as 'armed' | 'calibrating')
    )
  }
  return false
}
