import { describe, expect, it } from 'vitest'
import {
  decodePhoneMessage,
  encodePhoneMessage,
  isPhoneMessage,
  type PhoneMessage,
} from './wire'

describe('phone wire format', () => {
  it('encodes a commit message as JSON', () => {
    const msg: PhoneMessage = { type: 'commit', t: 1_234_567 }
    expect(JSON.parse(encodePhoneMessage(msg))).toEqual(msg)
  })

  it('round-trips a commit message through encode/decode', () => {
    const msg: PhoneMessage = { type: 'commit', t: 42 }
    const decoded = decodePhoneMessage(encodePhoneMessage(msg))
    expect(decoded).toEqual(msg)
  })

  it('round-trips a ping message through encode/decode', () => {
    const msg: PhoneMessage = { type: 'ping', t: 7 }
    expect(decodePhoneMessage(encodePhoneMessage(msg))).toEqual(msg)
  })

  it('returns null for non-JSON payloads', () => {
    expect(decodePhoneMessage('not json')).toBeNull()
  })

  it('returns null for JSON missing a known type tag', () => {
    expect(decodePhoneMessage('{"foo":"bar"}')).toBeNull()
  })

  it('returns null for a known tag with a wrong-typed t field', () => {
    expect(decodePhoneMessage('{"type":"commit","t":"oops"}')).toBeNull()
  })

  it('rejects messages with unknown type tags so 2b.2+ can add new variants safely', () => {
    expect(decodePhoneMessage('{"type":"future_kind","t":1}')).toBeNull()
  })

  it('isPhoneMessage narrows union members', () => {
    const x: unknown = { type: 'commit', t: 99 }
    expect(isPhoneMessage(x)).toBe(true)
    if (isPhoneMessage(x)) {
      // type-narrow check: t is number
      expect(x.t).toBe(99)
    }
  })

  it('isPhoneMessage rejects null and non-objects', () => {
    expect(isPhoneMessage(null)).toBe(false)
    expect(isPhoneMessage(undefined)).toBe(false)
    expect(isPhoneMessage(42)).toBe(false)
    expect(isPhoneMessage('hi')).toBe(false)
  })
})
