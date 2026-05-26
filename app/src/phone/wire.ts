export type PhoneMessage =
  | { type: 'commit'; t: number }
  | { type: 'ping'; t: number }

const KNOWN_TYPES = new Set<PhoneMessage['type']>(['commit', 'ping'])

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
  if (!KNOWN_TYPES.has(o.type as PhoneMessage['type'])) return false
  if (typeof o.t !== 'number') return false
  return true
}
