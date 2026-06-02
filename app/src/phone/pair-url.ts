/**
 * Phase 2b.2 — pure URL/fragment helpers shared by laptop PairScreen
 * and phone PhoneApp. Extracted so they can be unit-tested without
 * mounting React or the WebRTC stack.
 *
 * Phase 2b.5 — the QR no longer hard-codes a `/phone` path against the
 * Settings LAN IP. Instead it reflects the laptop's *current* origin +
 * base path and carries the phone role in the URL hash. This makes
 * pairing work unchanged whether the app is served from a local Vite dev
 * server or a public static host (GitHub Pages under `/<repo>/`), where
 * there is no SPA fallback to resolve a `/phone` path. See
 * `artifacts/decision-memo.md` §"Phase 2b.5 — Static-host QR pairing".
 */

/** The subset of `window.location` the URL helpers read. */
export interface PhoneLocation {
  protocol: string
  hostname: string
  port: string
  pathname: string
}

export type PhoneRole = 'phone' | null

/**
 * True for hosts the phone cannot reach by copying the laptop's URL —
 * the loopback names a dev server binds locally. For these we must swap
 * in the laptop's LAN IP (from Settings); for any other (deployed) host
 * the origin is reachable as-is.
 */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

/**
 * Build the URL the laptop encodes into the offer QR (and shows for
 * manual entry when `offerPayload === null`).
 *
 * The phone must load the *same deployment* the laptop is running, so the
 * URL is derived from `loc` (the laptop's `window.location`):
 * - On a deployed host (GitHub Pages, etc.) the origin + base path are
 *   used verbatim — they already resolve to the served `index.html`.
 * - On a loopback dev host the phone cannot reach `localhost`, so the
 *   host is swapped for `lanIp`. Without a `lanIp` we cannot produce a
 *   reachable URL and return `null` so the caller can fall back to manual
 *   pairing with a "set your LAN IP" hint.
 *
 * The phone role + offer ride in the hash (`#role=phone&offer=<payload>`)
 * rather than the path, so the request always lands on the real
 * `index.html` and needs no server-side route or SPA fallback.
 */
export function buildPhoneUrl(
  loc: PhoneLocation,
  lanIp: string | null,
  offerPayload: string | null,
): string | null {
  const ip = lanIp?.trim() || null

  let host: string
  let port: string
  if (isLoopbackHost(loc.hostname)) {
    if (!ip) return null
    host = ip
    port = loc.port
  } else {
    host = loc.hostname
    port = loc.port
  }

  const portPart = port ? `:${port}` : ''
  const base = `${loc.protocol}//${host}${portPart}${loc.pathname}`
  const fragment = offerPayload
    ? `#role=phone&offer=${offerPayload}`
    : '#role=phone'
  return `${base}${fragment}`
}

/**
 * Parse the URL fragment the phone receives. Tolerant of an empty hash, a
 * missing leading `#`, and unknown keys. Returns the compressed `offer`
 * payload (2b.2) and the `role` marker (2b.5) used to decide whether the
 * phone companion should mount.
 *
 * The expected `offer` payload is base64url (charset `[A-Za-z0-9_-]`),
 * which contains no `+`. URLSearchParams form-decodes `+` → space, so any
 * future fragment value that introduces `+` would corrupt silently;
 * callers must keep the alphabet base64url-clean.
 */
export function parsePhoneFragment(hash: string): {
  offer: string | null
  role: PhoneRole
} {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return { offer: null, role: null }
  const params = new URLSearchParams(raw)
  const offer = params.get('offer')
  return {
    offer: offer && offer.length > 0 ? offer : null,
    role: params.get('role') === 'phone' ? 'phone' : null,
  }
}

/**
 * Decide whether to mount the phone companion for a given location.
 *
 * Two forms are accepted:
 * - The hash role marker (`#role=phone`) the 2b.5 QR/manual flow emits —
 *   works on any host including static deployments under a base path.
 * - The legacy `/phone` path (2b.1–2b.4), kept so a hand-typed
 *   `http://<lan-ip>:5173/phone` against a Vite dev server still works.
 */
export function isPhoneRoute(loc: { pathname: string; hash: string }): boolean {
  if (/^\/phone(\/|$)/.test(loc.pathname)) return true
  return parsePhoneFragment(loc.hash ?? '').role === 'phone'
}
