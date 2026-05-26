# Phase 2b decision memo — Phone-as-Sensor decomposition

(Supersedes the Phase 5 memo. Prior memos preserved in git history.)

## Decision summary

Phase 2b is decomposed into **four sub-phases**, each independently shippable
and verifiable, totaling roughly 1–2 hours of focused work per sub-phase.

| Sub-phase | Title | Ships |
| --- | --- | --- |
| 2b.1 | LAN companion-page hosting + manual offer/answer signaling skeleton | Phone loads a page from the laptop. Manual SDP copy-paste establishes a WebRTC DataChannel. |
| 2b.2 | QR-code pairing flow | Replace manual paste with QR scan; laptop generates QR, phone scans, answer SDP sent back via second QR or short LAN HTTP POST. |
| 2b.3 | Accelerometer threshold detection + calibration screen | Phone produces "commit" events on motion impulses. Laptop has a calibration screen that tunes per-athlete threshold. |
| 2b.4 | Wire `inputSource = 'phone'` into the drill engine + session metadata | Athlete selects "Phone" in Settings; reps stored with `inputSource: 'phone'`; analytics treats it like pedal. |

Recommended ship order is 2b.1 → 2b.2 → 2b.3 → 2b.4. The minimal next slice
(implemented in a later iteration) is **2b.1**. Everything else builds on the
transport it establishes.

The hard problems (signaling, hosting, iOS HTTPS) are answered up front so
each sub-phase has unambiguous scope.

## Resolved red-team blockers

Architecture-red-team flagged four blocking concerns; each is resolved below
before 2b.1 begins.

### B1 — Pairing trust model

The earlier draft proposed an offer-SDP nonce. It is removed.

Phase 2b's threat model is *home-gym Wi-Fi*: a single athlete trains alone,
the LAN is trusted, and the worst plausible attack is a roommate connecting
their phone for amusement. We do not build cryptographic peer auth for that.
Pairing is implicitly authorized by the human physically holding the phone
that scanned the QR (2b.2) or pasted the offer (2b.1).

**Concretely**: 2b.1 accepts any answer whose SDP parses cleanly. Future
versions, if a real threat model emerges, can wrap the SDP in a signed
envelope. Do not ship vague "light auth" claims.

### B2 — WebRTC test-gate concession

Per `docs/QUALITY_GATES.md` *Testing gate*: every public behavior needs a
test that would fail when the behavior is reverted. WebRTC handshakes and
`getUserMedia` cannot be exercised reliably under jsdom or headless
Playwright. This memo formally records the following concession:

- **Pure logic** (peer-state machine, wire format, motion impulse detection,
  calibration math) is fully unit-tested under vitest. These tests gate the
  builder's claim that the modules behave correctly.
- **Transport handshake and motion events** are gated by a documented
  manual-QA script (`app/verify-phase-2b1.mjs` etc.) modeled on the existing
  `app/verify-phase4.mjs` / `app/verify-phase5.mjs` pattern. Each sub-phase
  ships a verify script and a checklist signed off in
  `artifacts/phase-2bN-verify/results.json`.
- **The phase-approval artifact for each sub-phase must include a
  `manual_qa` field** listing the steps performed and the device used.
  Without that field, the phase is not approved.

This is a project-specific deviation from the universal testing gate. It is
limited in scope to Phase 2b transport/sensor work and is justified by the
unavailability of WebRTC + DeviceMotion in the project's automated test
environment. Document this in `docs/QUALITY_GATES.md` (a one-line
"Browser-API limitations" footnote — not a gate rewrite) as part of 2b.1.

### B3 — Falsifiable 2b.3 acceptance

The "within 50ms of the impulse peak" criterion is unobservable from the
laptop. Rewritten 2b.3 acceptance criteria:

- 60s at rest on a flat surface → **0** commit events received by the laptop.
- 5 deliberate forward-snap impulses (single user, single session) → **5**
  commit events received (±0).
- Double-snap within the debounce window (300ms) → **1** commit event.
- Calibration: 5 sample swings → threshold persists; re-running calibration
  overwrites the prior threshold; threshold survives page reload.

All four are observable from the laptop's debug surface (2b.1 already ships
the receive-side timestamp display) and falsifiable on a real device.

### B4 — Phone OS strategy: ship for both, gate on Android

`docs/SPEC.md` does not specify the athlete's phone OS. The previous draft
hedged. Final strategy:

- **2b.1, 2b.2, 2b.3 acceptance is gated on Android** (Chrome over plain
  HTTP on LAN). The athlete can install the companion page on Android in
  about 10 seconds with no certificate dance.
- **iOS support is shipped as a documented path** in `docs/SETUP_IOS.md`
  (authored in 2b.3): install mkcert on the laptop, generate a LAN cert,
  install the root CA on the iPhone, serve Vite with `--https`. iOS
  motion permission then works.
- **If the athlete is on iOS**, they follow `docs/SETUP_IOS.md` *once*. The
  failure mode (cert dance is too painful) is recoverable: the athlete
  falls back to pedal + keyboard, which already covers the
  "physical commitment" requirement per the existing PHASES.md rationale
  for Phase 2b's deprioritization.
- **If the athlete is on Android**, no extra setup. The companion page works.

This avoids blocking on a question the project's source-of-truth docs
cannot answer (SPEC.md is silent) while ensuring no user is left without a
path. The acceptance gate is Android; iOS is documented but not CI-gated.

## Options considered for the *signaling* problem

The athlete and laptop are on the same Wi-Fi. The phone must hand the laptop
its WebRTC SDP answer (and ICE candidates) somehow. Three options:

### Option A — Manual SDP copy/paste in textareas
- Laptop renders `RTCPeerConnection.createOffer()` as base64 text in a
  textarea. User copies it onto the phone (typing-too-long; only viable if
  paired with QR — see 2b.2).
- Pure P2P. No server at all.
- Pro: zero infra, fits the local-first guarantee literally.
- Con: UX is unusable as a steady state, but it's the right *scaffold* —
  prove the WebRTC path works before adding QR.

### Option B — QR code for offer, QR or short LAN HTTP POST for answer
- Laptop generates QR containing offer SDP + ICE candidates (compressed +
  base64). Phone scans, creates answer, then either:
  - **B1**: phone renders its own QR with the answer; laptop's webcam scans
    it (requires laptop webcam access + a second scan flow — heavy).
  - **B2**: phone POSTs its answer to a tiny laptop-side HTTP endpoint on
    the same origin that served the companion page. Endpoint lives in the
    same Vite dev plugin / static handler that serves the SPA. This is
    *not* a remote signaling server; it's a localhost listener bound to
    the LAN interface and dies when the laptop closes the tab/app.
  - **B3**: laptop polls a known-shape QR field on the phone screen via
    user-driven re-scan (one QR each way, user clicks "I scanned it" —
    only requires phone camera, which we already need).
- Pro: one-shot pairing the user actually wants.
- Con: needs either webcam access on laptop (B1), a laptop HTTP listener
  (B2), or asks the user to do two scans (B3).

### Option C — Tiny LAN WebSocket signaling server bundled into the app
- Run a `ws://` server on the laptop (Node, or a Vite plugin in dev /
  Tauri or Electron in prod). Phone connects via `ws://laptop-lan-ip:port`
  to swap SDP, then WebRTC peer-to-peer takes over.
- Pro: simplest signaling code path (well-known WebSocket dance), supports
  reconnect and richer pairing UX.
- Con: introduces a server process. The project today is a static SPA
  served by `vite build → dist/` with no runtime backend (per
  ARCHITECTURE.md). Adding a Node server means either (a) requiring a
  `pnpm run companion-server` step the user must keep running, or (b)
  packaging the app via Tauri/Electron. Both are bigger commitments than
  Phase 2b warrants.

### Recommendation: **Option A scaffold for 2b.1, then Option B3 (two-QR scan) for 2b.2**

- 2b.1 lands the WebRTC DataChannel with copy-paste textareas. This proves
  the transport works without committing to a signaling UX.
- 2b.2 replaces the copy-paste with QR codes on both ends. The laptop has a
  webcam already (it's where the user trains), so it can scan the phone's
  answer QR. Two scans is acceptable one-time setup; once paired, the
  DataChannel persists for the session.
- Reject Option C: a real signaling server breaks the "static SPA, no
  server" architecture. We may revisit if the user reports the two-QR
  flow is too slow in practice — at which point a Vite dev-server plugin
  that exposes a `/signal` POST endpoint is a small follow-up (Option B2
  becomes viable).

Tradeoff: Option C would give a nicer first-time flow but pulls in a
runtime dependency the project does not have. Pairing is rare (once per
training session, often once per week); two QR scans is acceptable.

## Options considered for the *companion page hosting* problem

The phone needs a URL to load. Three options:

### Option H1 — Same Vite SPA, separate route (`/phone`)
- Add a route check at the top of `App.tsx` (or before mount in
  `main.tsx`) that swaps the root component when `location.pathname`
  starts with `/phone`. Phone renders a tiny companion UI; laptop renders
  the existing trainer UI.
- Same `dist/` output. Same dev server. Same origin → no CORS, same
  cookies/localStorage if we ever needed them.
- Bundle cost: the phone pulls down the same JS that drives the laptop.
  Bundle is 341 KB / 105 KB gzip today; phone is on the same Wi-Fi; this
  is fine. Code-split the phone route only if measured to be slow.

### Option H2 — Separate static HTML file (`public/phone.html`) with its own tiny bundle
- A second Vite entry point. Phone loads `phone.html`; laptop loads
  `index.html`.
- Pro: phone bundle stays small and independent.
- Con: dual Vite entries; more build config; risk of types drift across
  two roots; doesn't share `engine/types.ts` for the wire-format
  definitions unless we still import them.

### Option H3 — Separate sub-project / sibling package
- Heavy. Overkill for two screens.

### Recommendation: **H1 (same SPA, `/phone` route)**

- Cheapest. One bundle, one source tree, shared TS types for the wire
  format. The DataChannel message shape lives in one file
  (`app/src/phone/wire.ts`) imported by both roots.
- Code-split later if the phone bundle becomes a problem.

**How does the phone discover/load it?** The laptop trainer renders a QR
code (rendered during 2b.2; manual URL during 2b.1) containing
`https://<laptop-lan-ip>:5173/phone#<offer-sdp>` (dev) or
`https://<laptop-lan-ip>:4173/phone#<offer-sdp>` (`vite preview`). The
offer SDP rides in the URL fragment so the phone gets it on first load
without a second exchange — the fragment is never sent to a server,
which is fine because there is no server.

For LAN IP discovery, prompt the user once in Settings: "Your laptop's
LAN IP (e.g. 192.168.1.42)". Persist in `SettingsRecord`. We do not
auto-detect (browsers don't expose host LAN IP). A small "Test"
button does a `fetch('/phone')` to confirm.

## Options considered for the *iOS DeviceMotion HTTPS* problem

iOS Safari blocks `DeviceMotionEvent.requestPermission()` over plain HTTP.
Android Chrome does not. Three options:

### Option I1 — mkcert-issued local CA, document setup
- User installs mkcert, generates a cert for their LAN IP, and Vite serves
  with HTTPS. Phone trusts the cert (on iOS this means installing the
  root CA profile, which is a known but real friction point).
- Pro: real HTTPS, works on iOS, works on Android, no warnings.
- Con: one-time setup is non-trivial. Documented in `docs/` not in-app.

### Option I2 — Self-signed cert + accept-warning on phone
- Cheaper to set up but every browser warns on every reconnect. iOS Safari
  *still* will not grant DeviceMotion permission for a cert it doesn't
  trust — verified behavior across iOS 15+.
- Rejected on iOS. Works in a degraded "warning every time" mode on
  Android.

### Option I3 — Defer iOS entirely; ship Android-only first
- Document that the companion page works on Android out of the box over
  HTTP (Chrome doesn't gate motion events on HTTPS), and iOS requires
  the mkcert setup in I1.
- Phase 2b.1 ships as "works on Android over HTTP." Phase 2b.3 documents
  mkcert as the path to iOS support but doesn't *require* it for
  acceptance.

### Recommendation: **I3 for 2b.1–2b.3; I1 documented for iOS users**

- We test the whole pipeline on Android in CI / qa-playwright (no iOS
  emulator in the toolchain anyway).
- `docs/SETUP_IOS.md` (new, owned by 2b.3) walks the iOS user through
  mkcert + cert install.
- 2b.3 acceptance does **not** require iOS-on-HTTP working; it requires
  Android-on-HTTP working AND an iOS user can follow the doc to enable
  motion permission. Mention both `vite --host --https` (config) and
  `vite preview --host --https` (production-build serve) in the doc.

Tradeoff: the athlete may be on iOS. If so, they do the one-time mkcert
dance once. We do not invest engineering time wrestling with iOS quirks
on the happy path.

## Recommended approach: ship order and dependency chain

```
2b.1 (transport)  →  2b.2 (QR pairing UX)  →  2b.3 (motion + calibration)  →  2b.4 (engine wiring)
```

Each later phase depends on the prior one's transport guarantee. Reasoning:

- **2b.1 first** because *nothing else can be verified* until a phone can
  open a DataChannel to the laptop. The transport is the riskiest unknown
  (WebRTC + LAN); ship it stand-alone with the worst UX (copy-paste) and
  prove it works.
- **2b.2 next** because the QR flow is purely a UX upgrade over 2b.1 — it
  swaps how SDP bytes move between the two devices but keeps the
  DataChannel logic identical. Easy to A/B against 2b.1 manually.
- **2b.3 next** because motion detection has its own calibration concerns
  (per-athlete threshold) and would muddy the waters if combined with
  transport debugging. With transport already trusted, a 2b.3 failure is
  unambiguously a sensor-side bug.
- **2b.4 last** because wiring `inputSource = 'phone'` into the existing
  drill engine is a small, mechanical change once a "commit" event
  arrives reliably. Doing it before 2b.3 would force us to fake commit
  events, which we already do in tests.

The minimal sub-phase to take first (in the *next* iteration): **2b.1**.

---

## Sub-phase 2b.1 — LAN companion-page + WebRTC DataChannel with manual SDP

### Scope
- Add `/phone` route to the existing SPA via `H1`.
- Build the WebRTC offer/answer dance on both sides.
- "Pair" screen on laptop shows offer SDP in a textarea + paste-area for
  the answer.
- Companion page on phone shows offer paste-area + answer textarea +
  "Send commit" button (manual button, not motion — that's 2b.3).
- DataChannel echoes a single `{ type: 'commit', t: number }` message on
  the button. Laptop displays "commit received at +Xms" — debug surface
  only, not yet wired to the drill.
- Settings gains a "Laptop LAN IP" field used to build the phone URL.

### Files to touch / add
- `app/src/main.tsx` — route on `location.pathname.startsWith('/phone')`
  to a new `PhoneApp` root; otherwise mount the existing `App`.
- `app/src/phone/PhoneApp.tsx` — new: phone-side root with offer paste +
  answer textarea + "Send commit" button.
- `app/src/phone/wire.ts` — new: shared TS types for the DataChannel
  messages (`PhoneEvent = { type: 'commit'; t: number } | { type:
  'calibration'; ... }`).
- `app/src/phone/peer.ts` — new: pure-ish wrapper around
  `RTCPeerConnection` + DataChannel. Symmetric API used by both ends.
- `app/src/ui/PairScreen.tsx` — new: laptop-side pairing UI launched
  from Settings or a new "Pair phone" button on IdleScreen.
- `app/src/ui/SettingsScreen.tsx` — add "Laptop LAN IP" field.
- `app/src/store/settings-types.ts` — add `laptopLanIp?: string` to
  `SettingsRecord`.
- `app/src/store/settings.ts` — pass-through for the new field in
  load/save.
- `app/index.html` — unchanged (single entry).
- `app/vite.config.ts` — add `server.host: true` (already needed to
  serve on LAN IP). Add `preview.host: true` for production-build
  serve.

### Acceptance criteria
- Loading `http://<laptop-lan-ip>:5173/phone` on a phone on the same
  Wi-Fi renders the PhoneApp.
- From the laptop's Pair screen, copying the offer to the phone, copying
  the answer back, and clicking "Connect" produces a `connected`
  DataChannel within 5 seconds.
- Pressing the phone's "Send commit" button updates a "Last commit at"
  line on the laptop Pair screen within 200ms (LAN RTT is typically
  <30ms; budget is generous).
- All 105 existing tests pass. New tests cover `wire.ts` types/encoding
  if any, and `peer.ts` with stub `RTCPeerConnection` for offer/answer
  pure logic.
- Lint + tsc + vite build clean.

### Open technical decisions
- **STUN server (N3 resolved)**: ship with
  `iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]` by default.
  A single UDP packet at pairing time; ongoing media traffic stays
  peer-to-peer on the LAN. Removes the silent "ICE never completes"
  failure mode mesh-networked users would otherwise hit. The
  local-first guarantee is intact — no relay, no signaling server.
- **Base64 SDP length**: SDP blobs run 1.5–3 KB. Manual paste is
  tolerable in 2b.1; QR in 2b.2 will need a chunked QR or numeric-mode
  compression (or, simpler, gzip+base64).
- **Reconnect**: if the phone screen sleeps or the DataChannel drops,
  user re-pairs from scratch in 2b.1. Auto-reconnect is out of scope.
- **Throwaway scaffolding (N1 resolved)**: the `PairScreen.tsx` two-
  textarea UI shipped in 2b.1 is explicitly scheduled for deletion in
  2b.2 when QR replaces paste. Builder should not polish that UI
  (no icons, no fancy styling, no copy-button affordances). The
  surviving artifacts from 2b.1 are `phone/peer.ts`, `phone/wire.ts`,
  the `/phone` route plumbing in `main.tsx`, and the `laptopLanIp`
  settings field.
- **Routing (red-team Q)**: the SPA today is single-page with Zustand
  screen state — no router library. Adding a `pathname.startsWith
  ('/phone')` check at the top of `main.tsx` is the smallest change.
  For `vite preview` (production build serve), add `historyApiFallback`
  equivalent in `vite.config.ts` under `preview`. Dev server already
  serves `index.html` for unknown paths.

### Test strategy
- `app/src/phone/peer.test.ts`: stub `RTCPeerConnection` (jsdom doesn't
  provide it); verify that `createOffer → setLocalDescription →
  exposed SDP string` flows. Mostly tests our wrapper, not WebRTC.
- `app/src/phone/wire.test.ts`: type-narrowing tests for the message
  union, JSON round-trip on each message variant.
- Manual qa-playwright: open laptop in one browser context, phone-sized
  context on `/phone`, paste offer/answer between them, click commit,
  assert the laptop screen updates. (No real WebRTC under Playwright
  because jsdom and headless contexts don't fully implement it — this
  may need to be a real-browser Playwright run, not headless. Document
  this in QA notes.)
- Manual real-device: laptop + phone on same Wi-Fi, paste flow works.
  Logged as a "Phase 2b.1 manual QA checklist" in the verify artifact.

### Risks and mitigations
- *WebRTC under headless Playwright is flaky*: drop to logic-level tests
  in vitest; mark the end-to-end pairing as a documented manual step in
  the verify artifact. (Phase 4 already has a `verify-phase4.mjs`
  manual script; same pattern.)
- *Same-origin policy + mixed content*: if Phase 2b.3 introduces HTTPS,
  this works because Vite dev-server with `--host --https` covers
  both. 2b.1 sticks to HTTP for Android-only; iOS users will see
  acceptance fail at 2b.3 without mkcert (documented).
- *Bundle bloat from including `RTCPeerConnection` polyfill*: none —
  it's a native browser API.

### Rollback path
The entire `phone/` subtree is new code; the `/phone` route is
isolated. Removing the route guard in `main.tsx` and dropping the
`phone/` directory reverts cleanly. `SettingsRecord.laptopLanIp` is
optional → not a schema migration.

---

## Sub-phase 2b.2 — QR-code pairing flow

### Scope
- Replace the textarea copy-paste in 2b.1 with two QR exchanges:
  1. Laptop renders a QR containing the URL + offer SDP (gzipped +
     base64 in the URL fragment).
  2. Phone scans, opens the URL, auto-applies the offer, computes the
     answer, then renders its own QR with the compressed answer SDP.
  3. Laptop uses `navigator.mediaDevices.getUserMedia({ video: true })`
     + a tiny in-browser QR decoder to read the phone's answer QR.
- "Pair" screen on laptop has three states: showing-offer, scanning-
  answer, connected.

### Files to touch / add
- `app/src/phone/qr.ts` — new: QR encode (offer) + QR decode (answer)
  helpers. Vendor a small dependency: `jsqr` (decode, ~40 KB) +
  `qrcode` (encode, ~30 KB) — both pure-JS, tree-shakeable. Add to
  `package.json`.
- `app/src/ui/PairScreen.tsx` — extend the 2b.1 UI: add QR display
  for offer, webcam preview + jsqr scan loop for answer.
- `app/src/phone/PhoneApp.tsx` — auto-parse offer from URL fragment;
  render answer QR.

### Acceptance criteria
- User clicks "Pair phone" on laptop → QR appears.
- User scans QR with phone camera → PhoneApp loads, auto-applies offer,
  renders an answer QR within 3 seconds.
- User points laptop webcam at phone screen → laptop auto-detects QR
  and establishes DataChannel within 5 seconds total.
- Manual textarea path from 2b.1 remains available behind a "Show
  manual pairing" toggle (fallback for environments without a laptop
  webcam).
- All tests still pass; lint/tsc/build clean.

### Open technical decisions
- **QR payload size**: SDP can exceed standard QR capacity. Either gzip
  before base64 (typical 30–50% reduction; usually fits in a single QR
  at error-correction level L), or chunk into multiple QRs the phone
  cycles through (more complex, last resort). Start with gzip; chunk
  only if measured to fail.
- **Webcam permission UX**: laptop needs `getUserMedia`. Prompt once,
  remember dismissal in settings. Provide a fallback toggle.
- **jsqr scan loop**: ~30 fps decode is overkill; run at 10 fps to
  keep CPU usage low.

### Test strategy
- `qr.test.ts`: round-trip a sample SDP through encode/decode at
  multiple sizes; assert chunking kicks in if (and only if) size
  exceeds threshold.
- Manual qa-playwright: cannot exercise `getUserMedia` easily;
  document as manual real-device test, same as 2b.1.
- Real-device QA: scan QR with phone, scan QR back with laptop,
  DataChannel connects.

### Risks and mitigations
- *Adding `jsqr` and `qrcode` bumps bundle ~70 KB raw (N7 budget)*.
  Acceptable target: +25 KB gzip on the main bundle, or +0 KB if
  lazy-loaded behind `React.lazy(() => import('./ui/PairScreen'))`.
  2b.2 must lazy-load; the raw 70 KB is acceptable only inside the
  pair-screen chunk.
- *Camera quality* on low-end laptops may fail to decode. The manual
  textarea path stays as fallback (kept behind a "Show manual
  pairing" toggle as the 2b.1 scaffolding gets promoted to fallback
  rather than deleted).
- *Camera permission collides with Phase 7 webcam pose detection
  (N4)*. Acquire `getUserMedia` via a shared module
  (`app/src/util/camera.ts`, new in 2b.2) so the permission prompt
  is requested once and Phase 7 reuses the same gate.

### Rollback
Hide the QR UI behind a feature flag; the manual paste from 2b.1
still works. Removing the QR helpers and reverting PairScreen to its
2b.1 shape reverts cleanly.

---

## Sub-phase 2b.3 — Accelerometer threshold detection + calibration

### Scope
- PhoneApp listens to `devicemotion` events, computes a simple impulse
  metric (jerk = derivative of acceleration magnitude, or peak
  acceleration above gravity in a sliding window), and emits a
  `{ type: 'commit', t: number }` message when the metric exceeds the
  athlete's calibrated threshold.
- New laptop-side "Calibrate" screen reachable from PairScreen and
  Settings:
  - Laptop instructs athlete to throw 5 sample punches/steps
  - Phone streams a live `{ type: 'sample', peakG: number, t: number }`
    feed for ~10 seconds
  - Laptop computes p10 of peak G values across the samples, sets
    threshold at `p10 - epsilon` to admit the athlete's softest
    intended commit. Persists per-athlete in a new `calibrations`
    Dexie store (or a field on the active profile — see open decision).
- iOS only: phone shows a "Tap to enable motion" button that calls
  `DeviceMotionEvent.requestPermission()` on user gesture.

### Files to touch / add
- `app/src/phone/motion.ts` — new: motion event listener + impulse
  metric computation. Pure function for the metric to keep it testable.
- `app/src/phone/PhoneApp.tsx` — wire up motion listener; gate behind
  a permission button on iOS; send `commit` events over DataChannel.
- `app/src/ui/CalibrateScreen.tsx` — new: laptop-side calibration UI.
- `app/src/engine/types.ts` — add `phoneCalibration?: { thresholdG:
  number; calibratedAt: number }` to `ProfileRecord.config` (or to
  SettingsRecord — see decision).
- `docs/SETUP_IOS.md` — new: mkcert walkthrough.

### Acceptance criteria
(See §B3 above for the falsifiable rewrite. Restated here for the builder.)

- 60s at rest on a flat surface → **0** commit events.
- 5 deliberate forward-snap impulses → exactly **5** commit events
  (verified from the laptop's debug surface inherited from 2b.1).
- Double-snap within the 300ms debounce window → exactly **1** commit.
- Calibration: 5 sample swings → threshold persists in storage;
  re-running calibration overwrites the prior value; threshold
  survives a page reload.
- Android Chrome over plain HTTP: works without prompts (Chrome does
  not gate `devicemotion`).
- iOS Safari: `docs/SETUP_IOS.md` (new, authored here) documents the
  mkcert path. iOS acceptance is doc-driven, not CI-gated (per §B4).

### Resolved technical decisions
- **Per-profile threshold storage (N6 resolved)**: store
  `phoneCalibration: { thresholdG: number; calibratedAt: number }`
  on `ProfileRecord.config`. Schema reasoning:
  - Phase 4 already established profiles as the unit of drill
    configuration. Calibration is part of how a profile *runs*.
  - The taper-mode profile generator (Phase 5) copies `config`
    wholesale; calibration travels with it automatically.
  - `SettingsRecord` stays small and singleton — it carries per-
    laptop preferences (pedal binding, LAN IP), not per-athlete body
    state.
  - Profiles without a calibration fall back to a sensible default
    (`thresholdG: 1.8`, a moderate impulse). The default is declared
    a constant in `engine/types.ts` alongside `DEFAULT_DRILL_CONFIG`.
  - Migration: existing profiles have no `phoneCalibration` — the
    field is optional. Dexie schema version bump is **not** required;
    the field is read with `??` fallback to the default.
- **Impulse metric**: simplest is `max(|a| - g)` over a 200ms sliding
  window. More sophisticated is to compute jerk (numeric derivative)
  and threshold *that*. Start simple; revise if false-positives are
  too frequent in real-device QA.
- **Debounce**: once a commit fires, ignore further events for 300ms
  to avoid double-trigger from the recoil.

### Test strategy
- `motion.test.ts`: pure-function tests on the impulse metric and
  threshold-crossing logic. Feed synthesized accel streams (still
  baseline, one impulse, double-tap, calibration sequence) and
  assert expected commit timestamps.
- Calibration math: feed 5 sample peakG values, assert resulting
  threshold matches `p10 - epsilon`.
- qa-playwright: cannot generate fake `devicemotion` easily — mark as
  manual real-device step.
- Real-device QA: documented script in verify-phase-2b.mjs (analogous
  to verify-phase4.mjs):
  1. Connect phone.
  2. Set phone on table → no commits in 30s.
  3. Punch motion × 5 → exactly 5 commits.
  4. Run calibration → threshold persists across reload.

### Risks and mitigations
- *iOS user can't get mkcert working*: the doc is detailed; if they
  give up they can still use keyboard/pedal. Phone-as-sensor is
  marked as an optional input source in the spec.
- *Motion thresholds vary wildly by phone hardware*: the per-profile
  calibration captures this; the default is a fallback, not a claim.
- *Multiple commits per intended punch*: the 300ms debounce + jerk-
  rather-than-peak metric should mitigate. Tunable from Settings.

### Rollback
The motion code is gated behind the phone input source. Reverting to
the 2b.2 shape leaves the "Send commit" button as a manual fallback;
calibration screen is hidden.

---

## Sub-phase 2b.4 — Wire `inputSource = 'phone'` into engine + session metadata

### Scope
- Add `'phone'` to the `InputSource` union (`app/src/engine/types.ts:44`).
- Settings UI: add `<option value="phone">Phone (motion)</option>` to
  the input-source select.
- IdleScreen: if `inputSource === 'phone'` and no DataChannel is
  connected, show a banner "Phone not paired — pair now" with a button.
  Disable Start if not paired.
- TrainerScreen: subscribe to the DataChannel; on receiving a
  `commit` message, call the same `recordPress(at)` function that
  keyboard/pedal already use.
- SummaryScreen: already shows `inputSource` — no change needed.
- Analytics (Phase 5): no change; `inputSource` is opaque to it.

### Files to touch
- `app/src/engine/types.ts` — `InputSource = 'keyboard' | 'pedal' |
  'phone'`. Existing rep records remain compatible (the field is just
  a string).
- `app/src/store/session.ts` — `start()`'s `inputSource` arg already
  accepts the new value.
- `app/src/ui/SettingsScreen.tsx` — extend select options.
- `app/src/ui/IdleScreen.tsx` — pre-flight check for paired phone.
- `app/src/ui/TrainerScreen.tsx` — DataChannel subscription.
- `app/src/phone/peer.ts` — expose a singleton connection getter
  (`getPhonePeer()`) so multiple screens can subscribe.

### Acceptance criteria
- User in Settings picks "Phone", lands on Idle.
- If unpaired: banner + pair button block Start.
- If paired: Start enabled, drill runs, phone commits drive reps.
- Saved `SessionRecord.inputSource === 'phone'`.
- All 105+ existing tests still pass. New tests cover the union-
  member addition and the IdleScreen pre-flight gate.

### Resolved technical decisions
- **Singleton peer lifecycle (N5 resolved)**: the peer lives in a
  Zustand slice, **not** a module-level singleton. Reasoning:
  `getDb()` is idempotent and stateless from the caller's POV; a
  peer connection has lifecycle state (connecting/connected/
  disconnected/error), event listeners, and triggers re-renders.
  Zustand already wires re-renders for `useSession`, `useSettings`,
  `useProfiles` — adding `usePhonePeer` to that same pattern keeps
  the React update model consistent. The actual `RTCPeerConnection`
  instance is owned by the slice; components only see its state.
- **DataChannel drops mid-session**: pause the drill, banner "Phone
  disconnected — reconnect to continue". Mirrors a pedal unplug
  feel. Tracked by the Zustand slice's `connectionState`.
- **Backward compat for old `SessionRecord.inputSource`**: existing
  rows have `'keyboard' | 'pedal'`; the type widening to include
  `'phone'` is purely additive. No migration.

### Test strategy
- `session.test.ts`: extend the existing inputSource test to cover
  `'phone'`.
- `SettingsScreen` test: select "phone", verify settings persist.
- `IdleScreen` test: when inputSource is 'phone' and `getPhonePeer()`
  returns disconnected, Start is disabled.
- qa-playwright: full pair → calibrate → drill → summary flow.
  Acknowledge real-device dependency in the verify artifact.

### Rollback
The `'phone'` literal is removed from the `InputSource` union;
existing rows with `inputSource: 'phone'` would type-error on read.
Mitigation: keep the type as `'keyboard' | 'pedal' | 'phone' |
string` for one version if we ever roll back, or use a string cast
at the read boundary. Realistically, Phase 2b lands together or
not at all.

---

## Risks and mitigations (cross-cutting)

- **WebRTC is harder to test than HTTP.** Mitigation: keep transport
  logic in pure-ish modules (`peer.ts`, `wire.ts`, `motion.ts`) that
  vitest can exercise; reserve full pairing for manual real-device
  QA documented in `verify-phase-2b*.mjs`.
- **iOS HTTPS friction.** Mitigation: ship Android-only acceptance;
  doc-driven iOS support; do not block Phase 2b on iOS.
- **Bundle bloat from QR libraries.** Mitigation: `React.lazy` around
  PairScreen so the pairing modules only download when needed.
- **The phone goes to sleep mid-drill (N8 resolved).** PhoneApp requests
  `navigator.wakeLock.request('screen')` while a DataChannel is open. If
  the API is missing (Safari < 16.4 on iOS), the PhoneApp shows a banner:
  *"Your iOS version does not support keep-screen-awake — please disable
  auto-lock in Settings → Display & Brightness while training."* No
  silent degradation.
- **LAN trust model (see §B1).** Pairing is implicitly authorized by
  the human holding the phone. We do not ship cryptographic peer auth
  for Phase 2b. If this becomes a real concern, a signed offer envelope
  is a small follow-up.
- **Phase 5 analytics breakage:** `inputSource = 'phone'` may surface
  in trend rows. Verify the analytics text labels handle the new value
  (probably already do; the field is opaque to most analytics math).

## Test strategy summary

Per sub-phase the unit/vitest layer covers all pure logic (wire format,
QR encode/decode, peer wrapper, motion impulse detection, calibration
math, IdleScreen gate). The manual real-device layer covers the
end-to-end pairing and motion-trigger paths; each sub-phase ships a
verify script + manual QA checklist (mirroring `verify-phase4.mjs`).

qa-playwright tests cover everything *except* WebRTC handshake and
`devicemotion` (browsers under test don't provide either reliably).
These are documented as a known limitation in the verify artifact.

## Acceptance criteria for the next implementation step (2b.1)

- New `/phone` route exists; visiting it on a phone on the same Wi-Fi
  renders `PhoneApp`.
- Laptop "Pair phone" screen produces an offer SDP textarea.
- Manual copy/paste of offer onto phone + answer onto laptop establishes
  a DataChannel within 5 seconds (in a real-device QA run).
- Pressing the phone's "Send commit" button echoes a `commit` message
  the laptop displays with a timestamp.
- `SettingsRecord` carries a new optional `laptopLanIp` field.
- All 105 existing tests pass. New unit tests for `wire.ts` and
  `peer.ts` (the parts that don't need real `RTCPeerConnection`).
- Lint + tsc + vite build clean; bundle growth budget +20 KB gzip.
- Documented manual QA steps in `app/verify-phase-2b1.mjs` (new).
- `docs/PHASES.md` updated to add 2b.1–2b.4 (a separate, builder-
  driven edit — this memo is the input).

## Out-of-scope (explicitly deferred past 2b.4)

- Multi-phone support (one phone per laptop, one DataChannel at a time).
- Phone-driven UI for selecting drills (the spec marks phone as sensor
  only, not primary UI).
- Auto-reconnect on transient drops (manual re-pair only).
- iOS-on-HTTP support (requires Apple to change Safari).
- Cloud signaling fallback (would break local-first guarantee).
- Pose-based commit detection (Phase 7).
