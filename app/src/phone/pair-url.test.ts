import { describe, expect, it } from 'vitest'
import { buildPhoneUrl, parsePhoneFragment } from './pair-url'

describe('buildPhoneUrl', () => {
  it('embeds the offer payload in the URL fragment when provided', () => {
    const url = buildPhoneUrl(
      { protocol: 'http:', lanIp: '192.168.1.42', port: '5173' },
      'PAYLOAD',
    )
    expect(url).toBe('http://192.168.1.42:5173/phone#offer=PAYLOAD')
  })

  it('returns the bare /phone URL when no offer payload is provided', () => {
    const url = buildPhoneUrl(
      { protocol: 'http:', lanIp: '192.168.1.42', port: '5173' },
      null,
    )
    expect(url).toBe('http://192.168.1.42:5173/phone')
  })

  it('respects the page protocol so https laptops produce https URLs', () => {
    const url = buildPhoneUrl(
      { protocol: 'https:', lanIp: '10.0.0.5', port: '4173' },
      'X',
    )
    expect(url).toMatch(/^https:\/\//)
  })

  it('omits the colon when port is empty', () => {
    const url = buildPhoneUrl(
      { protocol: 'http:', lanIp: '10.0.0.5', port: '' },
      null,
    )
    expect(url).toBe('http://10.0.0.5/phone')
  })
})

describe('parsePhoneFragment', () => {
  it('extracts the offer payload from a #offer=... fragment', () => {
    expect(parsePhoneFragment('#offer=PAYLOAD')).toEqual({ offer: 'PAYLOAD' })
  })

  it('tolerates a missing leading #', () => {
    expect(parsePhoneFragment('offer=PAYLOAD')).toEqual({ offer: 'PAYLOAD' })
  })

  it('returns null offer when the fragment is empty', () => {
    expect(parsePhoneFragment('')).toEqual({ offer: null })
    expect(parsePhoneFragment('#')).toEqual({ offer: null })
  })

  it('returns null offer when the fragment has no offer key', () => {
    expect(parsePhoneFragment('#other=thing')).toEqual({ offer: null })
  })

  it('returns null when the offer key is present but empty', () => {
    expect(parsePhoneFragment('#offer=')).toEqual({ offer: null })
  })

  it('ignores unknown keys alongside the offer key', () => {
    expect(parsePhoneFragment('#offer=X&debug=1')).toEqual({ offer: 'X' })
  })
})
