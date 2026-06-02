/**
 * Phase 2b.2 — offer/answer SDP <-> URL-fragment payload.
 *
 * Wire shape: `<gzip(sdpUtf8)>` then base64url-encoded.
 * The payload rides in the laptop->phone QR as `…/phone#offer=<payload>`,
 * and in the phone->laptop QR as a bare payload string the laptop's
 * webcam decodes back to an SDP answer.
 *
 * Threshold rationale: QR Version 25 / EC-L holds ~1273 bytes in byte
 * mode. We cap at 1200 to leave room for the URL prefix and a small
 * safety margin. Compressed SDPs are typically ~0.6–1.2 KB; oversize is
 * the exception, not the rule.
 */

export const QR_PAYLOAD_THRESHOLD_BYTES = 1200

/**
 * Hard ceiling for the *final* string a QR encodes. QR Version 25 / EC-L
 * holds ~1273 bytes in byte mode; we treat that as the limit.
 *
 * Phase 2b.5: the offer QR encodes a full URL — payload PLUS the
 * origin/base/hash prefix — and that prefix grew (a custom domain + a
 * `/<repo>/` base path is much longer than `…:5173/phone`). So the offer
 * QR must be sized against the assembled URL, not the payload alone;
 * `QR_PAYLOAD_THRESHOLD_BYTES` only bounds the bare-payload answer QR the
 * phone renders. Use `fitsSingleQr` for the offer-URL check.
 */
export const QR_MAX_URL_BYTES = 1273

/** True when `qrText` fits in a single Version-25/EC-L byte-mode QR. */
export function fitsSingleQr(qrText: string): boolean {
  return qrText.length <= QR_MAX_URL_BYTES
}

export type EncodeResult =
  | { ok: true; payload: string; byteLength: number }
  | { ok: false; reason: 'oversize'; byteLength: number }

export type DecodeResult =
  | { ok: true; sdp: string }
  | { ok: false; reason: 'empty' | 'b64' | 'gzip' }

export async function tryEncodeOffer(sdp: string): Promise<EncodeResult> {
  const compressed = await gzip(new TextEncoder().encode(sdp))
  const payload = base64UrlEncode(compressed)
  const byteLength = payload.length
  if (byteLength > QR_PAYLOAD_THRESHOLD_BYTES) {
    return { ok: false, reason: 'oversize', byteLength }
  }
  return { ok: true, payload, byteLength }
}

export async function tryDecodeOffer(payload: string): Promise<DecodeResult> {
  if (!payload) return { ok: false, reason: 'empty' }
  let bytes: Uint8Array
  try {
    bytes = base64UrlDecode(payload)
  } catch {
    return { ok: false, reason: 'b64' }
  }
  let sdpBytes: Uint8Array
  try {
    sdpBytes = await gunzip(bytes)
  } catch {
    return { ok: false, reason: 'gzip' }
  }
  return { ok: true, sdp: new TextDecoder().decode(sdpBytes) }
}

async function gzip(input: Uint8Array): Promise<Uint8Array> {
  return runStream(input, new CompressionStream('gzip'))
}

async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  return runStream(input, new DecompressionStream('gzip'))
}

async function runStream(
  input: Uint8Array,
  transform: GenericTransformStream,
): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input)
      controller.close()
    },
  })
  const out = source.pipeThrough(transform)
  const reader = (out as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
    }
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bin, 'binary').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(payload: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(payload)) throw new Error('not base64url')
  let b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  const bin = typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary')
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
