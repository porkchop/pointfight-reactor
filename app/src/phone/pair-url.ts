/**
 * Phase 2b.2 — pure URL/fragment helpers shared by laptop PairScreen
 * and phone PhoneApp. Extracted so they can be unit-tested without
 * mounting React or the WebRTC stack.
 */

export interface PhoneUrlParts {
  protocol: string
  lanIp: string
  port: string
}

/**
 * Build the URL the laptop encodes into the offer QR. The phone scans
 * the QR, opens this URL, and the URL fragment carries the compressed
 * offer SDP so PhoneApp can auto-apply it on first render.
 *
 * `offerPayload === null` returns the bare /phone URL — used in manual
 * mode to display the URL the user should type into the phone.
 */
export function buildPhoneUrl(
  parts: PhoneUrlParts,
  offerPayload: string | null,
): string {
  const portPart = parts.port ? `:${parts.port}` : ''
  const base = `${parts.protocol}//${parts.lanIp}${portPart}/phone`
  return offerPayload ? `${base}#offer=${offerPayload}` : base
}

/**
 * Parse the URL fragment the phone receives after scanning the laptop's
 * offer QR. Tolerant of an empty hash, missing leading `#`, and unknown
 * keys — only the `offer` key is meaningful in 2b.2.
 *
 * The expected payload is base64url (charset `[A-Za-z0-9_-]`), which
 * contains no `+`. URLSearchParams form-decodes `+` → space, so any
 * future fragment value that introduces `+` would corrupt silently;
 * callers must keep the alphabet base64url-clean.
 */
export function parsePhoneFragment(hash: string): { offer: string | null } {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return { offer: null }
  const params = new URLSearchParams(raw)
  const offer = params.get('offer')
  return { offer: offer && offer.length > 0 ? offer : null }
}
