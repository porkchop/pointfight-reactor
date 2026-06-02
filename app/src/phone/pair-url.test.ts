import { describe, expect, it } from 'vitest'
import { buildPhoneUrl, isPhoneRoute, parsePhoneFragment } from './pair-url'

const loopback = (over: Partial<Parameters<typeof buildPhoneUrl>[0]> = {}) => ({
  protocol: 'http:',
  hostname: 'localhost',
  port: '5173',
  pathname: '/',
  ...over,
})

const deployed = (over: Partial<Parameters<typeof buildPhoneUrl>[0]> = {}) => ({
  protocol: 'https:',
  hostname: 'www.aaroncaswell.com',
  port: '',
  pathname: '/pointfight-reactor/',
  ...over,
})

describe('buildPhoneUrl', () => {
  it('on a loopback dev host, swaps in the LAN IP and keeps the port', () => {
    const url = buildPhoneUrl(loopback(), '192.168.1.42', 'PAYLOAD')
    expect(url).toBe('http://192.168.1.42:5173/#role=phone&offer=PAYLOAD')
  })

  it('on a loopback dev host with no LAN IP, returns null (caller falls back to manual)', () => {
    expect(buildPhoneUrl(loopback(), null, 'PAYLOAD')).toBeNull()
    expect(buildPhoneUrl(loopback(), '   ', 'PAYLOAD')).toBeNull()
  })

  it('treats 127.0.0.1 as loopback too', () => {
    const url = buildPhoneUrl(
      loopback({ hostname: '127.0.0.1' }),
      '192.168.1.42',
      null,
    )
    expect(url).toBe('http://192.168.1.42:5173/#role=phone')
  })

  it('treats IPv6 loopback (::1 and [::1]) as loopback', () => {
    expect(
      buildPhoneUrl(loopback({ hostname: '::1' }), '192.168.1.42', null),
    ).toBe('http://192.168.1.42:5173/#role=phone')
    expect(
      buildPhoneUrl(loopback({ hostname: '[::1]' }), '192.168.1.42', null),
    ).toBe('http://192.168.1.42:5173/#role=phone')
    // …and without a LAN IP, IPv6 loopback also falls back to manual.
    expect(buildPhoneUrl(loopback({ hostname: '::1' }), null, 'X')).toBeNull()
  })

  it('on a deployed host, uses the origin + base path verbatim and ignores the LAN IP', () => {
    const url = buildPhoneUrl(deployed(), '192.168.1.42', 'PAYLOAD')
    expect(url).toBe(
      'https://www.aaroncaswell.com/pointfight-reactor/#role=phone&offer=PAYLOAD',
    )
  })

  it('on a deployed host with no LAN IP set, still builds a URL', () => {
    const url = buildPhoneUrl(deployed(), null, 'PAYLOAD')
    expect(url).toBe(
      'https://www.aaroncaswell.com/pointfight-reactor/#role=phone&offer=PAYLOAD',
    )
  })

  it('preserves a non-default port on a deployed host', () => {
    const url = buildPhoneUrl(
      deployed({ hostname: '10.0.0.5', port: '4173', pathname: '/' }),
      null,
      'X',
    )
    expect(url).toBe('https://10.0.0.5:4173/#role=phone&offer=X')
  })

  it('omits the offer key when no payload is provided (manual mode)', () => {
    expect(buildPhoneUrl(deployed(), null, null)).toBe(
      'https://www.aaroncaswell.com/pointfight-reactor/#role=phone',
    )
    expect(buildPhoneUrl(loopback(), '192.168.1.42', null)).toBe(
      'http://192.168.1.42:5173/#role=phone',
    )
  })

  it('respects the page protocol so http laptops produce http URLs', () => {
    const url = buildPhoneUrl(
      deployed({ protocol: 'http:', hostname: 'example.com' }),
      null,
      'X',
    )
    expect(url).toMatch(/^http:\/\//)
  })
})

describe('parsePhoneFragment', () => {
  it('extracts the offer payload from a #offer=... fragment', () => {
    expect(parsePhoneFragment('#offer=PAYLOAD')).toEqual({
      offer: 'PAYLOAD',
      role: null,
    })
  })

  it('extracts the phone role marker', () => {
    expect(parsePhoneFragment('#role=phone')).toEqual({
      offer: null,
      role: 'phone',
    })
  })

  it('extracts both role and offer from the 2b.5 fragment shape', () => {
    expect(parsePhoneFragment('#role=phone&offer=PAYLOAD')).toEqual({
      offer: 'PAYLOAD',
      role: 'phone',
    })
  })

  it('tolerates a missing leading #', () => {
    expect(parsePhoneFragment('offer=PAYLOAD')).toEqual({
      offer: 'PAYLOAD',
      role: null,
    })
  })

  it('returns nulls when the fragment is empty', () => {
    expect(parsePhoneFragment('')).toEqual({ offer: null, role: null })
    expect(parsePhoneFragment('#')).toEqual({ offer: null, role: null })
  })

  it('returns null offer when the fragment has no offer key', () => {
    expect(parsePhoneFragment('#other=thing')).toEqual({
      offer: null,
      role: null,
    })
  })

  it('returns null when the offer key is present but empty', () => {
    expect(parsePhoneFragment('#offer=')).toEqual({ offer: null, role: null })
  })

  it('ignores unknown role values', () => {
    expect(parsePhoneFragment('#role=laptop')).toEqual({
      offer: null,
      role: null,
    })
  })

  it('ignores unknown keys alongside the offer key', () => {
    expect(parsePhoneFragment('#offer=X&debug=1')).toEqual({
      offer: 'X',
      role: null,
    })
  })
})

describe('isPhoneRoute', () => {
  it('matches the legacy /phone path (local dev, hand-typed)', () => {
    expect(isPhoneRoute({ pathname: '/phone', hash: '' })).toBe(true)
    expect(isPhoneRoute({ pathname: '/phone/', hash: '' })).toBe(true)
  })

  it('matches the 2b.5 hash role marker on the base path', () => {
    expect(
      isPhoneRoute({
        pathname: '/pointfight-reactor/',
        hash: '#role=phone&offer=PAYLOAD',
      }),
    ).toBe(true)
  })

  it('does not match the laptop app at the base path with no role marker', () => {
    expect(isPhoneRoute({ pathname: '/pointfight-reactor/', hash: '' })).toBe(
      false,
    )
  })

  it('does not treat a path merely containing "phone" as the phone route', () => {
    expect(isPhoneRoute({ pathname: '/telephone', hash: '' })).toBe(false)
  })
})
