import { describe, expect, it } from 'vitest'
import {
  fitsSingleQr,
  QR_MAX_URL_BYTES,
  QR_PAYLOAD_THRESHOLD_BYTES,
  tryDecodeOffer,
  tryEncodeOffer,
} from './qr'

const SAMPLE_SDP = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:abcd
a=ice-pwd:0123456789abcdef0123456789abcdef
a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF
a=setup:actpass
a=mid:0
a=sctp-port:5000
`

describe('qr offer encode/decode', () => {
  it('round-trips a typical SDP through encode -> decode', async () => {
    const enc = await tryEncodeOffer(SAMPLE_SDP)
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    expect(enc.payload.length).toBeGreaterThan(0)
    expect(enc.byteLength).toBeLessThanOrEqual(QR_PAYLOAD_THRESHOLD_BYTES)
    const dec = await tryDecodeOffer(enc.payload)
    expect(dec.ok).toBe(true)
    if (!dec.ok) return
    expect(dec.sdp).toBe(SAMPLE_SDP)
  })

  it('produces a URL-fragment-safe payload (base64url charset only)', async () => {
    const enc = await tryEncodeOffer(SAMPLE_SDP)
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    expect(enc.payload).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('flags oversize payloads instead of returning a too-large QR string', async () => {
    // gzip compresses repeated runs aggressively, so use a pseudo-random
    // (high-entropy) appendix to bust the threshold the way a fat SDP with
    // many ICE candidates would in real use.
    const bigSdp = SAMPLE_SDP + '\na=padding ' + randomChars(4000)
    const enc = await tryEncodeOffer(bigSdp)
    expect(enc.ok).toBe(false)
    if (enc.ok) return
    expect(enc.reason).toBe('oversize')
    expect(enc.byteLength).toBeGreaterThan(QR_PAYLOAD_THRESHOLD_BYTES)
  })

  it('rejects an empty payload on decode', async () => {
    const dec = await tryDecodeOffer('')
    expect(dec.ok).toBe(false)
    if (dec.ok) return
    expect(dec.reason).toBe('empty')
  })

  it('rejects malformed base64url on decode', async () => {
    const dec = await tryDecodeOffer('!!!not-base64!!!')
    expect(dec.ok).toBe(false)
    if (dec.ok) return
    expect(dec.reason).toBe('b64')
  })

  it('rejects valid base64 that is not valid gzip on decode', async () => {
    // Valid base64url that decodes to bytes that are not a gzip stream.
    const garbage = 'aGVsbG8gd29ybGQ' // "hello world"
    const dec = await tryDecodeOffer(garbage)
    expect(dec.ok).toBe(false)
    if (dec.ok) return
    expect(dec.reason).toBe('gzip')
  })

  it('exposes the byte length of the compressed payload so the UI can show the fallback reason', async () => {
    const bigSdp = SAMPLE_SDP + '\na=padding ' + randomChars(6000)
    const enc = await tryEncodeOffer(bigSdp)
    if (enc.ok) {
      throw new Error('expected oversize for padded SDP')
    }
    expect(enc.byteLength).toBeGreaterThan(0)
  })
})

describe('fitsSingleQr', () => {
  it('accepts a URL at or under the QR byte ceiling', () => {
    expect(fitsSingleQr('x'.repeat(QR_MAX_URL_BYTES))).toBe(true)
    expect(fitsSingleQr('https://www.aaroncaswell.com/pointfight-reactor/#role=phone&offer=PAYLOAD')).toBe(true)
  })

  it('rejects a URL over the QR byte ceiling', () => {
    expect(fitsSingleQr('x'.repeat(QR_MAX_URL_BYTES + 1))).toBe(false)
  })

  it('measures the whole URL, not just the payload — a max-payload offer plus a long prefix overflows', () => {
    // A payload right at the payload threshold still passes tryEncodeOffer,
    // but once wrapped in a long origin/base-path prefix the full QR string
    // can exceed the ceiling. This is the case the payload-only check missed.
    const longPrefix =
      'https://' +
      'a'.repeat(40) +
      '.example.com/' +
      'segment/'.repeat(8) +
      '#role=phone&offer='
    // The prefix alone eats more than the headroom between the two limits.
    expect(longPrefix.length).toBeGreaterThan(
      QR_MAX_URL_BYTES - QR_PAYLOAD_THRESHOLD_BYTES,
    )
    const url = longPrefix + 'P'.repeat(QR_PAYLOAD_THRESHOLD_BYTES)
    expect(url.length).toBeGreaterThan(QR_MAX_URL_BYTES)
    expect(fitsSingleQr(url)).toBe(false)
  })
})

function randomChars(n: number): string {
  // Deterministic LCG so the test is reproducible. Output is high-entropy
  // enough that gzip cannot compress it below threshold.
  let state = 0xC0FFEE
  let s = ''
  for (let i = 0; i < n; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    s += String.fromCharCode(33 + (state % 94))
  }
  return s
}
