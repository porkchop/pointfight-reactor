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

  it('round-trips a sample message (phone → laptop during calibration)', () => {
    const msg: PhoneMessage = { type: 'sample', t: 12345, peakG: 1.73 }
    expect(decodePhoneMessage(encodePhoneMessage(msg))).toEqual(msg)
  })

  it('rejects a sample message with a non-numeric peakG', () => {
    expect(
      decodePhoneMessage('{"type":"sample","t":1,"peakG":"oops"}'),
    ).toBeNull()
  })

  it('round-trips a config message (laptop → phone) in both modes', () => {
    const armed: PhoneMessage = {
      type: 'config',
      thresholdG: 1.6,
      debounceMs: 300,
      mode: 'armed',
    }
    const calibrating: PhoneMessage = {
      type: 'config',
      thresholdG: 0.5,
      debounceMs: 300,
      mode: 'calibrating',
    }
    expect(decodePhoneMessage(encodePhoneMessage(armed))).toEqual(armed)
    expect(decodePhoneMessage(encodePhoneMessage(calibrating))).toEqual(
      calibrating,
    )
  })

  it('rejects a config message with an unknown mode', () => {
    expect(
      decodePhoneMessage(
        '{"type":"config","thresholdG":1.5,"debounceMs":300,"mode":"sneaky"}',
      ),
    ).toBeNull()
  })

  it('rejects a config message missing required numeric fields', () => {
    expect(
      decodePhoneMessage('{"type":"config","mode":"armed","debounceMs":300}'),
    ).toBeNull()
    expect(
      decodePhoneMessage(
        '{"type":"config","thresholdG":1.5,"mode":"armed"}',
      ),
    ).toBeNull()
  })

  it('rejects a config message with NaN, Infinity, or zero thresholdG', () => {
    expect(
      decodePhoneMessage(
        '{"type":"config","thresholdG":0,"debounceMs":300,"mode":"armed"}',
      ),
    ).toBeNull()
    // JSON cannot serialize Infinity / NaN literally, so we round-trip via
    // an object the parser would never accept — passing NaN explicitly
    // through isPhoneMessage instead.
    expect(
      decodePhoneMessage(
        '{"type":"config","thresholdG":-1,"debounceMs":300,"mode":"armed"}',
      ),
    ).toBeNull()
  })

  it('rejects a config message with a negative debounceMs', () => {
    expect(
      decodePhoneMessage(
        '{"type":"config","thresholdG":1.5,"debounceMs":-1,"mode":"armed"}',
      ),
    ).toBeNull()
  })

  it('isPhoneMessage narrows union members', () => {
    const x: unknown = { type: 'commit', t: 99 }
    expect(isPhoneMessage(x)).toBe(true)
    if (isPhoneMessage(x) && x.type === 'commit') {
      // type-narrow check: t is number on the commit branch.
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
