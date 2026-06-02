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

---

## Phase 6 decomposition memo — Video Opponent Mode

### Decision summary
- Clip mode is a **separate input/render path** that reuses the existing
  `recordPress(at)` boundary and `RepRecord` schema with one additive
  field. No engine surgery.
- Clips are stored as **Blob in Dexie** (Option A). Largest realistic
  Phase-6 library is ~30 clips × 50 MB ≈ 1.5 GB — well inside Chrome's
  per-origin quota on a training laptop. Wins offline-first; matches the
  rest of the local-first storage idiom.
- Tagging UX is **one cue per clip, one tag, scrub-bar + frame step**.
  Multi-tag is deferred. Single-tag is the smallest shape that satisfies
  the acceptance criteria and keeps the engine path clean.
- The scheduler is **bypassed for clip mode**; the clip element itself
  is the "pre-cue delay" generator. A thin `clipRunner` slice owns the
  per-rep state machine and calls into the same `recordPress` path the
  keyboard/pedal/phone listeners use today.
- Decompose into **3 sub-phases**: 6.1 import+store, 6.2 tag, 6.3 play+record.

### 1. Storage strategy — Blob in Dexie (Option A)

| Option | Persistent | Cross-reload | Quota ceiling | Notes |
|---|---|---|---|---|
| (a) Blob in Dexie | yes | yes | ~10 % of disk (Chrome) | Fits idiom; one schema bump |
| (b) `URL.createObjectURL` ephemeral | no | no | RAM-bound | Clips re-imported every session — unusable |
| (c) File System Access API | yes | yes | full disk | Chrome-only, re-permission per session, breaks Phase-2b Android compat story |

Recommend **(a)**. Add a new Dexie table `clips: 'id, importedAt'`
holding `{ id, name, mimeType, durationMs, sizeBytes, importedAt, blob }`.
Bump `db.ts` to `version(4)`. Playback resolves the blob via
`URL.createObjectURL(clip.blob)` at render time and `revokeObjectURL` on
unmount — same pattern Chrome uses for IndexedDB-backed media.

Mitigation for quota exhaustion: surface `navigator.storage.estimate()`
in the clip-library screen, warn at >80 % usage, hard-cap at >95 % with
"delete a clip first". No silent failures.

### 2. Tagging UX — one tag per clip, scrub + step

Shape:
- Clip detail screen shows a `<video controls>` element plus a custom
  scrub bar with two buttons: **−1 frame** and **+1 frame** (step by
  `1/30s` since we don't know the source FPS; "good enough" for tagging
  at human reaction-time resolution).
- Athlete picks a `CueId` from the existing `CUE_LIBRARY` via a select
  (reuses the Phase-3 palette directly — no new cue data).
- Single tag persisted as `clip.cueId: CueId` + `clip.cueAtMs: number`.
- Edit overwrites; no version history.

Multi-tag is explicitly deferred. Two tags on one clip means clip mode
also has to model "pre-cue delay between tag-1 finish and tag-2", which
re-introduces the scheduler we just bypassed. Not worth it for Phase 6.

### 3. Playback engine integration — bypass the scheduler

The Phase-5 engine assumes:
1. `pickPreCueDelayMs(rng, config)` → setTimeout → `revealCue()`
2. `CueStage` renders the cue
3. `recordPress(at)` classifies

In clip mode steps 1 and 2 are *intrinsic to the video element*. The
clip plays from `t=0`; when `video.currentTime * 1000 >= clip.cueAtMs`,
that **is** "cue shown". The scheduler can't help — the timing source
is the video, not `setTimeout`.

Recommend a **parallel runner** in `app/src/clipmode/runner.ts` (new
Zustand slice `useClipRunner`) that:
- picks a random clip from the enabled library (`pickRandomClip(rng, clips)`),
- mounts `<video>`, calls `play()` to capture `clipStartedAt =
  performance.now()`,
- on `timeupdate` (or `requestVideoFrameCallback` if available), when
  `video.currentTime * 1000 >= clip.cueAtMs`, fires
  `revealClipCue()` which records `cueShownAt = clipStartedAt + clip.cueAtMs`,
- routes presses through `recordPress(at)` *unchanged*.

`useSession` is **not** reused for clip mode — clip runner produces its
own `RepRecord`s and `SessionRecord` directly via the existing `saveRep`
/ `saveSession` helpers. This keeps the Phase-5 scheduler untouched
(zero regression risk to shipped functionality) at the cost of some
duplication in the rep-commit code path (acceptable: ~30 lines).

### 4. RT measurement — reuses recordPress without engine change

`recordPress(at)` already takes a wall-clock `performance.now()` value
and diffs it against `cueShownAt`. As long as the clip runner produces
`cueShownAt = clipStartedAt + clip.cueAtMs` on the same `performance.now()`
clock, `classifyRep()` works as-is.

**No engine change required.** `classifyRep()` is a pure function in
`engine/drill.ts` and accepts arbitrary `cueShownAt` / `pressedAt`
pairs. Reuse directly from the clip runner.

One precision note: HTML5 `<video>` `timeupdate` fires at ~250 ms
resolution. Using `requestVideoFrameCallback` (Chrome 83+, Safari 15.4+)
brings this to per-frame (~16 ms at 60 fps), which matters because RT
measurement at <50 ms resolution is meaningless otherwise. Acceptance
gate: cue-shown event lands within **±33 ms** of the tagged frame.

### 5. Results storage — additive `clipId` on RepRecord, additive `mode` on SessionRecord

Smallest schema change:
- `RepRecord` gains `clipId?: string`.
- `SessionRecord` gains `mode?: 'live' | 'clip'` (default `'live'`,
  undefined treated as `'live'` for back-compat).
- Cue type is already on `RepRecord.cueId` — no change. The "results
  stored by clip and cue type" criterion is met by querying
  `reps.where('clipId').equals(id)` and grouping by `cueId`.

No new `ClipSessionRecord` type. Reasoning: every Phase-5 analytics
function (`cueBreakdown`, `antiRhythmSignal`, `best10AvgOf`) operates
on `RepRecord[]`. A separate type would fork analytics. The two extra
optional fields cost nothing for live sessions and unlock per-clip
drilldown for free.

Dexie change: bump to `version(4)`, add `clips: 'id, importedAt'`,
add `clipId` to the `reps` index → `reps: 'id, sessionId, cueId, clipId'`.

### 6. Sub-phase decomposition (N=3)

**Phase 6.1 — Clip library: import, store, list, delete**
- New `app/src/clipmode/library.ts` (pure: Blob → metadata extraction
  via offscreen `<video>` for `durationMs`).
- New `clipmode/db.ts` slice or extend `store/db.ts` with
  `addClip(blob)`, `listClips()`, `deleteClip(id)`.
- Dexie bump to `version(4)`; new `clips` table with the schema above.
- New `app/src/ui/ClipLibraryScreen.tsx` accessible from `IdleScreen`
  via a "Manage clips" link.
- Acceptance:
  - User picks a local .mp4 via `<input type="file" accept="video/mp4">`,
    sees it in the list with name, duration, size.
  - Reload preserves the list.
  - Delete removes blob + metadata.
  - Quota estimate visible; warning at >80 %.
  - `clipmode/library.test.ts` covers metadata extraction with a
    synthesized blob.
  - `app/verify-phase6-1.mjs` documents manual import of three clips.

**Phase 6.2 — Tagging UI**
- New `app/src/ui/ClipTagScreen.tsx`: video element, scrub bar,
  frame-step buttons, cue-type select sourced from `CUE_LIBRARY`,
  Save button.
- Persists `cueId` + `cueAtMs` on the existing clip record (Dexie
  in-place update; no new version bump needed since the columns are
  blob-internal JSON, not indexed).
- Acceptance:
  - From clip library, "Tag" opens the tag screen prefilled if a
    prior tag exists.
  - Scrub + frame-step land within 1 frame of the chosen position.
  - Cue-type select shows all 8 entries from `CUE_LIBRARY`.
  - Save persists; reload preserves.
  - Untagged clips are flagged in the library list ("needs tag") and
    excluded from playback in 6.3.
  - `ClipTagScreen.test.tsx` covers cue-id selection + persistence.

**Phase 6.3 — Random playback + RT measurement + per-clip results**
- New `app/src/clipmode/runner.ts` (Zustand slice).
- New `app/src/ui/ClipDrillScreen.tsx` (mounts `<video>`, drives the
  runner, renders the same `feedback` UI as `TrainerScreen`).
- `IdleScreen` gains a "Clip mode" start button that requires ≥1
  tagged clip.
- `RepRecord` gets `clipId?`, `SessionRecord` gets `mode?: 'clip' | 'live'`.
- Random selection via existing `rng.ts`; weighted-by-untaped-recently
  is *out of scope*.
- `SummaryScreen` shows a per-clip breakdown when `mode === 'clip'`,
  using `cueBreakdown(reps)` filtered by `clipId`.
- Acceptance:
  - Start "Clip mode" with 3 tagged clips → drill plays clips in
    random order.
  - Cue-shown event lands within ±33 ms of tagged frame (verified by
    `requestVideoFrameCallback` callback timestamp vs.
    `clipStartedAt + cueAtMs`).
  - Pressing keyboard/pedal/phone before cue → false start.
  - Pressing within hesitation threshold → correct_go with RT.
  - Pressing after late threshold → late.
  - Saved `SessionRecord.mode === 'clip'`; each `RepRecord` has the
    correct `clipId`.
  - Summary view groups results by clip → cue type.
  - `clipmode/runner.test.ts` exercises the state machine with a
    stubbed video element (manual `currentTime` advance).
  - `app/verify-phase6-3.mjs` documents a full library → tag → drill →
    summary flow.

Each sub-phase is independently demoable: 6.1 ships a working clip
library (browse + delete); 6.2 makes clips tag-able and visible; 6.3
turns the system into a working video opponent.

### 7. Risks / red-flags worth raising to architecture-red-team

- **R1 — Blob quota assumption.** Chrome's per-origin quota is
  documented as "up to ~60 % of free disk" on desktop, but on
  constrained training laptops (older Chromebooks, MacBook Airs with
  small SSDs) athletes will hit ceilings. Red-team: is the >80 %
  warning + >95 % hard cap enough? Alternative: pre-import transcode
  via WebCodecs to reduce file size. Probably yes, but worth a second
  look.
- **R2 — `requestVideoFrameCallback` browser support.** Safari 15.4
  shipped it; Safari < 15.4 falls back to 250 ms `timeupdate`
  resolution which makes RT measurement unreliable. Two paths:
  (a) document Chrome/Edge/recent-Safari requirement and refuse to
  enable Clip mode otherwise, (b) ship anyway with degraded precision.
  No clear winner — depends on the athlete's actual training laptop.
- **R3 — Forked rep-commit path.** Bypassing `useSession` for clip
  mode means two pieces of code call `saveRep`/`saveSession`. Could
  drift. Mitigation considered: extract a `commitRep()` helper to a
  new `engine/persistence.ts` that both `session.ts` and `runner.ts`
  call. Decided **against** for Phase 6.1–6.3 to keep the diff small;
  red-team should sanity-check that the duplication risk is bounded
  (~30 lines, both call sites in the same repo).
- **R4 — Tag granularity.** Single-tag-per-clip means "opponent steps
  in, then blitzes" must be two separate clips. Athletes may want
  multi-tag for realism. Confirm with the spec author that single-tag
  is acceptable for the post-tournament window, or queue a Phase 6.4
  for multi-tag (would need a `tags[]` schema + a synthetic-delay
  generator between tags).
- **R5 — Frame-step precision.** Hard-coded 1/30s step assumes a 30 fps
  source clip. A 60 fps phone-recorded clip would step by 2 frames at
  a time; a 24 fps cinema clip steps by 0.7 frames (likely no visible
  change). The fix is to extract FPS at import via
  `requestVideoFrameCallback` sampling, but that costs ~50 lines and
  may be unnecessary for the training use case. Red-team: tolerate
  hardcoded 30 fps step, or extract real FPS?
- **R6 — IdleScreen mode selector UX.** A second "Start" button on the
  IdleScreen is the cheapest path; a mode toggle / segmented control
  is cleaner. Bike-shed risk — flag for red-team to pick the shape so
  6.3 doesn't churn the UI shell twice.

### Red-team review — Phase 6 decomposition

1. **Hidden coupling / drift risk (forked rep-commit path).** **MODIFY.**
   §3 says "`useSession` is **not** reused for clip mode — clip runner
   produces its own `RepRecord`s and `SessionRecord` directly via the
   existing `saveRep` / `saveSession` helpers." Then §7/R3 admits "Could
   drift. Mitigation considered: extract a `commitRep()` helper to a
   new `engine/persistence.ts`. Decided **against** for Phase 6.1–6.3."
   This contradicts the DRY gate (`docs/QUALITY_GATES.md` §"DRY and
   reuse gate": "if the same logic appears in more than one layer,
   extract it to a shared module or justify the duplication in a
   decision memo"). The bypass duplicates the invariants encoded in
   `commitRep()` in `src/store/session.ts` lines 107–139: rep-id
   minting, `resolveCueAtDistance`, the `roundIndex` + `inputSource`
   fan-out, the `persistSession(null)` call after each rep, and the
   `feedback` state hand-off. That is at least five invariants Phase-5
   analytics already depend on, not "~30 lines of boilerplate." Any
   future change to `RepRecord` shape (e.g., adding a `responseId`
   field, or wiring the distance axis into clip mode) has to be made
   in two places or it silently rots. **Required change:** extract a
   pure `commitRep(input) -> { rep, summary }` helper in
   `engine/persistence.ts` (or `engine/rep.ts`) in 6.3 itself, not as a
   future refactor. `session.ts` and `clipmode/runner.ts` both call it.
   The "~30 LOC" argument is not a justification — it is the exact
   shape of duplication the DRY gate names. Either justify in writing
   why the two call sites encode *different* invariants (they don't —
   §4 explicitly says `classifyRep()` is reused as-is, so the invariant
   *is* the same), or extract.

2. **Schema evolution safety (Dexie v4).** **MODIFY.** The memo at §1
   says "Bump `db.ts` to `version(4)`" and at §5 says "bump to
   `version(4)`, add `clips: 'id, importedAt'`, add `clipId` to the
   `reps` index → `reps: 'id, sessionId, cueId, clipId'`." Two
   problems. (a) Adding an *index* to an existing Dexie store is a
   schema change Dexie handles by re-indexing, but the memo does not
   specify whether the `version(4).stores(...)` block must include
   *all four* tables (sessions, reps, settings, profiles, clips) — the
   existing pattern at `src/store/db.ts:14-28` redeclares every table
   in each version. Omitting any table in v4 drops it. **Required
   change:** the 6.1 acceptance criteria must explicitly state the
   full v4 `.stores()` declaration: `sessions: 'id, startedAt', reps:
   'id, sessionId, cueId, clipId', settings: 'id', profiles: 'id,
   createdAt', clips: 'id, importedAt'`. (b) The memo asserts existing
   v3 records remain valid because `clipId` and `mode` are *optional*.
   True for the data shape, but Dexie does not migrate or rewrite
   existing rows; the new `clipId` index will simply be `undefined` on
   old reps and they will not appear in `where('clipId').equals(id)`
   queries. The memo should state this explicitly so reviewers don't
   assume migration. **Required change:** add a "schema migration
   notes" sub-bullet under 6.1 acceptance: "v3 reps remain readable; no
   data migration; `where('clipId').equals(...)` on old reps returns
   empty (intended)."

3. **Acceptance-criteria falsifiability.** **MODIFY.** Several 6.1–6.3
   criteria are not falsifiable in an automated test:
   - 6.1 "Reload preserves the list" — testable via Dexie.
   - 6.1 "Quota estimate visible; warning at >80 %" — testable by
     stubbing `navigator.storage.estimate()`.
   - 6.2 "Scrub + frame-step land within 1 frame of the chosen
     position" — **not testable without a real `<video>` element**;
     jsdom does not implement `HTMLMediaElement.play()` /
     `currentTime` write semantics. This is the same class of
     concession as Phase 2b §B2 (WebRTC + DeviceMotion). The memo
     does not call this out.
   - 6.3 "Cue-shown event lands within ±33 ms of tagged frame
     (verified by `requestVideoFrameCallback` callback timestamp)"
     — same: `requestVideoFrameCallback` is not in jsdom. Manual-QA
     only.
   - 6.3 "drill plays clips in random order" — see concern 7 below;
     "random order" is not falsifiable without a distribution spec.

   **Required change:** add a §B5 cross-cut (or §6.0 sub-section)
   titled "Browser-API limitations — Phase 6" that names HTML5
   `<video>`, `requestVideoFrameCallback`, and `navigator.storage`
   as untestable in jsdom, lists which acceptance criteria are
   manual-QA-gated (6.2 scrub precision; 6.3 cue-shown timing), and
   requires `app/verify-phase-6{1,2,3}.mjs` scripts plus a `manual_qa`
   field in each sub-phase approval — mirroring the Phase 2b
   `docs/QUALITY_GATES.md` §"Browser-API limitations (Phase 2b)"
   footnote. Without this, 6.2 and 6.3 will be approved with no
   "would-fail-if-reverted" test for their core RT behavior.

4. **Storage quota / failure modes.** **MODIFY.** §1 says "Mitigation
   for quota exhaustion: surface `navigator.storage.estimate()` in the
   clip-library screen, warn at >80 % usage, hard-cap at >95 % with
   'delete a clip first'. No silent failures." This is good in
   principle but the 6.1 acceptance criteria do not test the
   *failure* path. What happens when `addClip(blob)` is called while
   already at 96 %? When Dexie's `put()` rejects with QuotaExceededError
   mid-write? The current code at `src/store/db.ts:61-69` swallows
   errors into `_openError` and returns void — `addClip` will need a
   different shape (return `{ ok: true } | { ok: false, reason }`)
   because the user MUST see the failure. **Required change:** 6.1
   acceptance must include (a) an `addClip` return type that surfaces
   QuotaExceeded as a typed result, not a void/swallowed error;
   (b) a unit test that stubs Dexie to throw `QuotaExceededError`
   and asserts the UI shows a non-silent error; (c) an explicit
   per-clip size cap (recommend 200 MB hard, 100 MB soft warning)
   so a single pathological upload cannot exhaust the budget. The
   memo's "~30 clips × 50 MB ≈ 1.5 GB" math assumes athletes will
   trim clips; nothing enforces it.

5. **RT precision under `requestVideoFrameCallback`.** **MODIFY.**
   §4 says "HTML5 `<video>` `timeupdate` fires at ~250 ms resolution.
   Using `requestVideoFrameCallback` (Chrome 83+, Safari 15.4+) brings
   this to per-frame (~16 ms at 60 fps)." §7/R2 then admits Safari <
   15.4 falls back to 250 ms. With the spec's hesitation threshold at
   450 ms and late threshold at 600 ms (`docs/SPEC.md` "Operational
   definitions"), a 250 ms `timeupdate` quantization means a press
   that classifies as "correct" on Chrome could classify as
   "hesitation" on old Safari — **the same press, the same clip**.
   That is measurement-system incoherence, not a "degraded precision"
   nuisance. R2 says "ship anyway with degraded precision" is on the
   table; that is not acceptable when the spec defines hesitation in
   tens-of-ms terms. **Required change:** pick path (a) from R2 —
   feature-detect `requestVideoFrameCallback` and refuse to enable
   Clip mode when absent. Add a 6.3 acceptance: "On a browser without
   `requestVideoFrameCallback`, IdleScreen's Clip-mode start button
   is disabled with the message 'Clip mode requires Chrome 83+,
   Edge, or Safari 15.4+'." This is the same shape as the existing
   "Phone not paired" gate in `src/ui/IdleScreen.tsx:60-81`.

6. **Mode-selector UX coupling.** **MODIFY.** §6 6.3 says "`IdleScreen`
   gains a 'Clip mode' start button that requires ≥1 tagged clip" and
   §7/R6 punts the UX shape to red-team. The matrix is real:
   inputSource ∈ {keyboard, pedal, phone} × mode ∈ {live, clip} = 6
   combinations. Phone-input + clip-mode is *not* nonsensical — the
   athlete stands in front of the laptop screen and the phone is
   strapped to their hand/foot — that is exactly how Phase 2b.3's
   calibration assumes phone is mounted. So all 6 combos are valid
   in principle. But the current IdleScreen already gates on
   phone-pairing (`src/ui/IdleScreen.tsx:38-40`): `phoneSelected &&
   !phoneReady` disables Start. In clip mode that gate still applies.
   **Required change:** 6.3 must explicitly state "Clip-mode Start
   inherits the existing phone-pairing gate from `IdleScreen`. Clip
   mode does **not** override inputSource; the user's configured
   inputSource is used to record presses." Also pick the UX shape
   *before* 6.3 ships, not as a follow-on: a segmented control above
   the Start button (Live / Clip) is the right answer because adding
   a second "Start" button breaks the existing single-`autoFocus`
   button affordance at `IdleScreen.tsx:94`. Specify this in the
   memo so 6.3 doesn't churn the shell twice.

7. **Random clip selection invariants.** **MODIFY.** §6 6.3
   acceptance says "Start 'Clip mode' with 3 tagged clips → drill
   plays clips in random order." §6 also says "Random selection via
   existing `rng.ts`; weighted-by-untaped-recently is *out of scope*."
   That is not enough to write a failing test. **Required change:** pin
   the distribution explicitly. Recommended: "uniform random with
   replacement, no repeat-immediately-previous constraint" (mirrors
   `pickNextCue` semantics). Then the test can be `for i in 0..200:
   pick; assert each of N clips appears within ±20% of N/200`. Also
   state explicitly that untagged clips are excluded (already implied
   by 6.2's "excluded from playback in 6.3" but worth restating in 6.3
   itself).

8. **Sub-phase ordering.** **ACCEPTED.** 6.1 → 6.2 → 6.3 is correct:
   6.2 needs persisted clips (you cannot tag what you cannot save and
   reload), so an "in-memory clip stash that gets replaced by Dexie
   later" would force re-importing every page reload and would
   actively block athlete dogfooding of tagging UX. The order does
   not lock in throwaway scaffolding — each sub-phase produces real,
   non-disposable surface area.

9. **Cross-cutting concerns from prior phases.** **BLOCK.** The
   memo does not include a §B5 (or equivalent) cross-cut analogous
   to Phase 2b's §B1–B4. Specifically missing: (a) browser-API
   testing concession for `<video>` and `requestVideoFrameCallback`
   (overlaps with concern 3 above — must be written into the memo,
   not just acknowledged in this review); (b) browser-version gate
   for Clip mode (overlaps with concern 5); (c) the equivalent of
   §B3 "falsifiable acceptance" — most of 6.2 and 6.3's acceptance
   criteria as written are *demonstrable* but not *falsifiable in
   CI*. This is a structural omission, not a typo. **Required next
   action:** the planner must append §B5 (browser-API limitations
   for Phase 6) and §B6 (falsifiable acceptance for clip-mode RT
   timing) to the "Resolved red-team blockers" section, mirroring
   the Phase 2b pattern, and update `docs/QUALITY_GATES.md` §
   "Browser-API limitations" to add a Phase-6 entry alongside Phase
   2b. No sub-phase approval should proceed without this.

10. **Project-complete signal.** **MODIFY.** The memo is silent on
    whether shipping Phase 6 (or its sub-phases) triggers the
    `done: true` final-completion artifact (`docs/QUALITY_GATES.md`
    §"Final completion artifact"). `docs/PHASES.md:182` marks Phase 6
    as "post-tournament unless ahead of schedule"; Phase 7 (webcam
    pose) is also "post-tournament." The autonomous loop needs a
    clean stop. **Required change:** add a "Project-complete
    signal" sub-section to the memo stating: "Shipping 6.1+6.2+6.3
    satisfies the Phase 6 acceptance criteria in `docs/PHASES.md`.
    Phase 7 (Webcam Pose Detection) is explicitly marked
    post-tournament and is NOT a project-complete blocker per
    `docs/SPEC.md` §'Non-Goals for MVP' ('Perfect pose detection')
    and §'Future Features' ('Webcam-based movement detection').
    The wrapper should write `artifacts/phase-approval.json` for
    6.3 with a `project_complete: true` flag (or write
    `done: true` directly) so the loop terminates."

**Verdict.** Send back to planner for a tightened revision. The plan
is structurally sound — the storage choice is right, the sub-phase
ordering is right, and §4's "no engine change" insight is the
correct lever. But concern 9 (missing §B5/B6 cross-cuts) is a
**BLOCK**, and the cluster of MODIFY findings (concerns 1, 3, 4, 5,
6, 10) are not "nice to have" — they are the difference between a
phase that can be tested and approved versus one that ships unreviewable
behavior under "manual-QA-only" cover. In particular: concern 1
(the forked rep-commit path) directly violates the DRY gate as
written, and concern 5 (Safari `<` 15.4 measurement incoherence)
would let the app silently report nonsense reaction times. None of
these requires re-architecting; all are concrete edits to the memo +
explicit gates added to the acceptance criteria. After the planner
revises and adds §B5/§B6 and the per-concern fixes above, the plan
is safe to advance to phase-update.

### Resolved red-team blockers — Phase 6

The following lock-ins replace the planner's original §1–§7 wherever they
conflict. Each addresses a specific red-team finding by ID. The sub-phase
acceptance criteria in `docs/PHASES.md` (written in the phase-update
artifact) must enumerate these as testable conditions.

#### §B5 — Browser-API limitations (Phase 6)

Mirroring `docs/QUALITY_GATES.md` §"Browser-API limitations (Phase 2b)":

- **Pure-logic modules** (`clipmode/library.ts` metadata extraction with
  stubbed `<video>`, `clipmode/runner.ts` state machine with manual
  `currentTime` advance, `clipmode/random.ts` distribution sampler,
  Dexie blob round-trip via `fake-indexeddb`) remain fully unit-tested.
  These tests gate the testing-gate's "would fail if reverted" rule.
- **HTML5 `<video>` element semantics** (`play()`, `currentTime` write,
  `timeupdate` cadence) and **`requestVideoFrameCallback`** are not
  implemented in jsdom. The cue-shown precision criterion (±33 ms of
  tagged frame) is gated by per-sub-phase manual real-device QA at
  `app/verify-phase6-{1,2,3}.mjs`.
- **`navigator.storage.estimate()`** can be stubbed in vitest for the
  >80 %/>95 % branches; live-quota behavior is manual-QA only.
- Each Phase-6 sub-phase approval artifact must include a `manual_qa`
  block naming the device (laptop OS + browser version) and the steps
  performed. Without it, the phase is not approved. This is a scoped
  concession identical in shape to Phase 2b's §B2.
- `docs/QUALITY_GATES.md` §"Browser-API limitations" will be updated in
  6.1 to add a Phase-6 entry alongside Phase 2b.

#### §B6 — Falsifiable acceptance for clip-mode RT

For each sub-phase, every acceptance criterion is one of:

- **AUTO** — a vitest test that would fail if the behavior were reverted
  (storage round-trip, quota-error result type, distribution sampler
  uniformity, classifyRep classification under stubbed `cueShownAt`).
- **GATE** — a `verify-phase6-N.mjs` Playwright check that asserts a
  DOM-observable condition (banner present, button disabled,
  start-button text, summary group counts) under headless chromium with
  the real `<video>` element. These are gate-grade because chromium
  ships `requestVideoFrameCallback` and HTML5 video.
- **MANUAL** — explicitly enumerated in the sub-phase's `manual_qa`
  checklist with operator sign-off (device + date). Only RT precision
  and end-to-end real-clip playback fall here.

A criterion that is neither AUTO nor GATE nor MANUAL is not a valid
acceptance criterion and must be removed or reshaped.

#### Concern 1 — DRY: extract `commitRep()` in 6.3, not later

Override §3 / §7-R3. Phase 6.3 ships with a new pure module
`app/src/engine/persistence.ts` exposing
`commitRep({ rep, sessionId, profile, distance }): { rep: RepRecord,
summary: Partial<SessionRecord> }` that wraps the invariants currently
inlined in `src/store/session.ts:107-139`: rep-id minting (`rngId`),
`resolveCueAtDistance`, `roundIndex` + `inputSource` fan-out, the
`persistSession(null)` boundary, and the `feedback` hand-off. Both
`session.ts` and `clipmode/runner.ts` call it. The 6.3 acceptance must
include: "session.ts and clipmode/runner.ts share a single
`commitRep()` implementation; reverting either call site to its own
rep-minting logic fails `engine/persistence.test.ts`." Refusing this is
a DRY-gate violation per `docs/QUALITY_GATES.md` §"DRY and reuse gate".

#### Concern 2 — Full Dexie v4 schema declaration + migration note

Override §1 / §5. Phase 6.1 acceptance criterion locks in the exact
declaration:

```ts
this.version(4).stores({
  sessions: 'id, startedAt',
  reps:     'id, sessionId, cueId, clipId',
  settings: 'id',
  profiles: 'id, createdAt',
  clips:    'id, importedAt',
});
```

Schema migration notes (must appear verbatim in 6.1 acceptance):
- All five tables are listed; omitting any drops it.
- Existing v3 reps remain readable. No data migration runs.
- `reps.where('clipId').equals(<any-id>)` returns empty for pre-v4 reps
  — intended, since they belong to live sessions.
- A vitest test asserts that v3 rows survive the v4 upgrade by seeding
  a v3 record into `fake-indexeddb`, reopening at v4, and asserting
  the row reads back unchanged.

#### Concern 4 — Typed `addClip()` return + per-clip size cap

Override §1's "no silent failures" hand-wave. Phase 6.1 acceptance:

- `addClip(blob)` returns
  `{ ok: true; clip: ClipRecord } | { ok: false; reason: 'quota' | 'too-large' | 'unsupported-type' | 'storage-error'; message: string }`.
- Per-clip hard cap: **200 MB**. Soft warning at **100 MB** (toast
  warns about quota burn).
- A unit test stubs Dexie's `put()` to throw a `QuotaExceededError`
  (DOMException with name `'QuotaExceededError'`) and asserts the call
  returns `{ ok: false, reason: 'quota' }` and that the UI renders a
  non-silent error banner with the returned `message`.
- A unit test calls `addClip()` with a 250 MB blob and asserts
  `{ ok: false, reason: 'too-large' }`.

#### Concern 5 — Feature-gate Clip mode on `requestVideoFrameCallback`

Override §4 / §7-R2's "no clear winner". Pick path (a): refuse to
enable Clip mode when `requestVideoFrameCallback` is absent. Phase 6.3
acceptance:

- A new export `clipmode/runtime.ts:isClipModeSupported()` returns
  `typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback'
  in HTMLVideoElement.prototype`.
- IdleScreen's "Clip mode" start button is disabled when
  `!isClipModeSupported()`, with a `data-testid="clip-mode-unsupported"`
  banner reading "Clip mode requires Chrome 83+, Edge, or Safari 15.4+
  for accurate frame timing." Same shape as the existing "Phone not
  paired" gate at `src/ui/IdleScreen.tsx:60-81`.
- Unit test stubs `HTMLVideoElement.prototype` to omit the method and
  asserts the banner renders + button disabled. Verify-phase6-3.mjs
  GATE check asserts the banner does NOT render under headless chromium
  (which supports the API).

This eliminates the cross-browser RT-incoherence risk by making clip
mode opt-in only on browsers where the RT measurement is meaningful.

#### Concern 6 — Mode selector UX shape: segmented control above Start

Override §6 6.3 / §7-R6. The IdleScreen mode selector is a **segmented
control** rendered above the Start button, with two options "Live" and
"Clip". Default is "Live" (no behavior change for existing users). The
existing single `autoFocus` Start button at `IdleScreen.tsx:94` is
preserved — Start dispatches based on the selected mode, not by being
a second button. Phase 6.3 acceptance:

- IdleScreen exposes `data-testid="mode-segmented"` with two children
  `data-testid="mode-live"` and `data-testid="mode-clip"`.
- Clip-mode Start inherits the existing phone-pairing gate verbatim:
  `phoneSelected && !phoneReady` still disables Start regardless of
  mode. (No code change to the gate logic — it sits above the
  mode-routing branch.)
- Clip mode does **not** override `inputSource`; the user's configured
  keyboard / pedal / phone input is used to record presses. The
  inputSource × mode matrix (6 combinations) is fully supported.
- Selecting Clip mode with zero tagged clips disables Start with a
  `data-testid="clip-mode-no-clips"` banner pointing to the clip
  library.

#### Concern 7 — Pin random clip distribution

Override §6 6.3 "drill plays clips in random order". Phase 6.3
acceptance pins the distribution:

- Selection is **uniform random with replacement, no
  repeat-immediately-previous constraint** (mirrors `pickNextCue`).
  Untagged clips are excluded from the candidate pool.
- A vitest test seeds a `mulberry32(...)` RNG, draws 200 picks from a
  5-clip pool, asserts each clip is drawn within ±20 % of 200/5 = 40
  picks. (`expect(count).toBeGreaterThanOrEqual(32)`,
  `toBeLessThanOrEqual(48)` per clip.)
- A second test asserts no `pick === prevPick` over 100 draws given
  ≥2 clips in the pool.

#### Concern 10 — Project-complete signal at 6.3

Shipping 6.1 + 6.2 + 6.3 satisfies all of Phase 6's acceptance criteria
in `docs/PHASES.md:182-194`. Phase 7 (Webcam Pose Detection) is
explicitly post-tournament per `docs/PHASES.md:196` and is listed under
`docs/SPEC.md` §"Non-Goals for MVP" / §"Future Features". The
autonomous loop's terminal signal:

- The 6.3 `phase-approval.json` artifact must set
  `"project_complete": true` at the top level.
- After the wrapper commits 6.3 approval, the next iteration writes
  `artifacts/project-complete.json` with
  `{ "complete": true, "final_phase": "6.3", "deferred": ["phase-7"],
    "deferred_reason": "post-tournament; not required for MVP per
    docs/SPEC.md" }`.

#### Documentation updates (lock-ins for 6.1)

`docs/QUALITY_GATES.md` §"Browser-API limitations (Phase 2b)" is renamed
to §"Browser-API limitations (Phase 2b + Phase 6)" with the Phase-6
content from §B5 above appended (HTML5 `<video>`,
`requestVideoFrameCallback`, `navigator.storage.estimate`).
`docs/PHASES.md` Phase-6 section is replaced (in the phase-update
artifact) with the 6.1/6.2/6.3 breakdown including the locked-in
acceptance criteria above.

#### Verdict resolution

All 8 MODIFY items above are now lock-ins, not options. The single
BLOCK (concern 9 — missing §B5/B6) is resolved by the §B5 and §B6
sections above. Concern 8 (sub-phase ordering) was ACCEPTED in the
review. The plan is now safe to advance to a `phase-update.json`
artifact that updates `docs/PHASES.md` with the 6.1/6.2/6.3
decomposition. No second red-team pass required — the resolutions are
mechanical, not architectural.



#### Testing-strategy lock-in (Phase 6.2)

Phase 6.2 is the first phase to introduce a `.test.tsx` component-test
surface (`ClipTagScreen.test.tsx`) — prior phases tested all UI gates
exclusively through the `verify-phaseN.mjs` Playwright scripts under
§B2 / §B5 concessions. The reason for the expansion:

- The Phase 6.2 acceptance criterion in `docs/PHASES.md` literally names
  `ClipTagScreen.test.tsx` "covers cue-id selection and persistence
  with a stubbed `<video>` element".
- `@testing-library/react` is the minimal vitest-compatible primitive
  for asserting JSX-rendered behavior under jsdom. Adding it (one
  devDep, no runtime cost) is preferable to either (a) skipping the
  literal `.test.tsx` requirement or (b) hand-rolling React DOM
  rendering with `act` boilerplate.
- The `verify-phase6-2.mjs` Playwright script remains the gate for the
  user-visible end-to-end flow (open library → click Tag → cue select
  → Save → reload → prefill); the `.test.tsx` covers component-level
  contracts (cue-id selection, prefill, frame-step math, blob-URL
  lifecycle stability across re-renders / saves).
- Project convention going forward: pure logic in `*.test.ts` under
  the owning module; component contracts in colocated `*.test.tsx`
  with @testing-library/react; user-visible end-to-end flows in
  `verify-phaseN.mjs`. The three layers do not overlap.
- `playwright` was added to `app/package.json` devDependencies in this
  phase as well; prior `verify-phaseN.mjs` scripts already imported it
  but the dep was previously implicit (relied on a globally-available
  playwright). Making it explicit is overdue housekeeping triggered
  by this phase's verify-script run.

---

# Phase 2b.5 — Static-host QR pairing

## Problem

Phases 2b.1–2b.4 built phone-as-sensor pairing against a **local Vite dev
server**: the laptop runs `npm run dev`, the phone loads
`http://<laptopLanIp>:5173/phone`, and the offer SDP rides in the URL
fragment. The laptop *is* the web server, so the phone reaches it over the
LAN. This works, but assumes the user is running a dev server.

The app is also deployed to **GitHub Pages** (`.github/workflows/pages.yml`,
`vite base: './'`) under a base path, reachable at a public HTTPS origin
(e.g. `https://www.aaroncaswell.com/pointfight-reactor/`). Loading the
companion from there is broken in three independent ways:

1. **The QR points at the laptop, not the deployment.** `buildPhoneUrl`
   built `<page-protocol>//<laptopLanIp>/phone` from the Settings LAN IP.
   On Pages the page protocol is `https:` and the port is empty, so the QR
   encoded `https://<lanIp>/phone` → port 443 on a machine with nothing
   listening → the phone hangs on a blank page forever (the reported bug).
2. **Base-path mismatch.** Route detection in `main.tsx` matched `^/phone`,
   which never matches `/<repo>/phone`.
3. **No SPA fallback.** Pages is static; `/<repo>/phone` 404s — there is no
   server to rewrite unknown paths to `index.html`.

## Decision

Route the phone by a **hash role marker on the laptop's current origin +
base path**, not by a `/phone` path against a Settings LAN IP.

- The offer QR encodes `<laptop origin><base path>#role=phone&offer=<payload>`
  derived from `window.location`. Wherever the laptop loaded the app, the
  phone loads the *same* deployment.
- The path always resolves to the real served `index.html`, so **no
  `404.html`, no SPA fallback, and no Pages-workflow change are needed.**
- `main.tsx` selects the phone companion via `isPhoneRoute(location)`:
  the hash marker (new, host-agnostic) **or** the legacy `/phone` path
  (kept so a hand-typed dev URL still works — backward compatible).
- The WebRTC DataChannel stays peer-to-peer (host + STUN srflx, Google
  STUN, **no TURN**). The page host is decoupled from the media path.

### Localhost substitution

`window.location.hostname` on a dev laptop is `localhost`/`127.0.0.1`,
which the phone cannot reach. So `buildPhoneUrl` keeps the existing
LAN-IP behaviour **only** for loopback hosts: substitute the Settings LAN
IP (preserving the dev port), and if none is set return `null` so the
caller falls back to manual paste. For any non-loopback (deployed) host the
origin is used verbatim and the LAN IP is irrelevant.

## Strategies considered

| Option | Verdict |
|---|---|
| **A. `404.html` SPA shim** (copy `index.html` → `404.html` so `/<repo>/phone` resolves) | Rejected. Adds a build/workflow step, leaves a path that 404-then-200s (flaky on some CDNs), and still needs base-path-aware `^/phone` matching. |
| **B. Absolute `base` + path route** | Rejected. Couples the route to a hard-coded base; breaks local dev at `/`. |
| **C. Hash role marker on current origin** (chosen) | Single uniform URL shape that works on Pages, any static host, and local dev; needs no server cooperation; offer already lived in the hash. |

## Resolved review findings (architecture-red-team + code-reviewer)

- **Connectivity is the real limitation (red-team B2).** Serving the page
  from a public origin **decouples "page loads" from "P2P connects."**
  Under the old model the phone *had* to reach the laptop's LAN server, so
  a loaded page implied a working data path. Now the page always loads; the
  DataChannel only connects when both devices route directly to each other:
  **same Wi-Fi, client/guest isolation off, no symmetric-NAT blocker.**
  With no TURN relay, guest networks / AP isolation / phone-on-mobile-data /
  corporate symmetric NAT **silently fail**. Accepted scope: *same
  non-isolated LAN only*; TURN is explicitly out of scope (no server in this
  project). Mitigation shipped: a 20 s connection-timeout diagnostic banner
  in `PairScreen` (`data-testid="connect-timeout"`) telling the user to put
  both devices on the same Wi-Fi with isolation off. Documented in
  `docs/SETUP_IOS.md` and the Settings hint.
- **QR capacity (red-team M5).** The QR encodes the whole URL, not just the
  payload, and the Pages prefix (custom domain + base path) is much longer
  than `…:5173/phone`. The old payload-only `oversize` check
  (`QR_PAYLOAD_THRESHOLD_BYTES`, 1200) no longer models the QR ceiling for
  the **offer** QR. Added `QR_MAX_URL_BYTES` (1273, Version-25/EC-L) +
  `fitsSingleQr(url)`; `PairScreen` now checks the assembled URL length and
  falls back to manual paste when it overflows. The bare-payload **answer**
  QR keeps the payload threshold.
- **Offer privacy + reload (red-team M4/M7).** The offer SDP embeds the
  laptop's private LAN IPs / ICE ufrag+pwd, now in the hash of a public
  origin. Hashes are not sent to servers, and the Pages bundle ships **no
  analytics/telemetry** (deps: dexie, framer-motion, jsqr, lucide-react,
  qrcode, react, zustand) — so there is no `location.href` exfiltration
  surface. As defence-in-depth the phone calls `history.replaceState` after
  capturing the offer to drop `offer=` from the URL/history/bfcache, while
  **keeping `#role=phone`** so a reload re-mounts the companion (not the
  laptop app). Constraint recorded: the Pages build must never add
  telemetry that reads `location.href`.
- **ICE fallback tradeoff (red-team M6).** `peer.ts`'s 1500 ms
  first-candidate fallback (committed in 2579e78) can cut gathering before a
  srflx candidate arrives, marginally hurting the cross-subnet case. Left
  unchanged this phase — it is pre-existing, the accepted scope is same-LAN
  (host candidates suffice), and changing ICE timing needs real-device
  testing. Noted as a known tradeoff.
- **iOS on Pages (red-team M3).** `docs/SETUP_IOS.md`'s mkcert ceremony
  exists to give iOS a trusted LAN HTTPS cert. On Pages the origin is
  already trusted HTTPS, so iOS DeviceMotion works **without** mkcert. Doc
  updated with a top-level fork. Corollary: an HTTPS Pages page cannot
  `fetch('http://<lan-ip>/…')` (mixed content), so any future LAN signaling
  endpoint is foreclosed by the Pages decision — WebRTC DataChannel/STUN
  traffic is exempt from the mixed-content blocker and is unaffected.
- **DRY (code-reviewer).** `isPhoneRoute` + `parsePhoneFragment` are the
  single source of truth for phone-route detection and fragment parsing,
  consumed by both `main.tsx` and `PhoneApp.tsx`. No duplicated parsing.

---

# Phase 2b.6 — Laptop answer-QR scan actually starts

## Problem (regression discovered during 2b.5 real-device QA)

With 2b.5 the phone finally loads from the public deployment, so the user
reached step 2 (the laptop's webcam scanning the phone's answer QR) for the
first time — and it silently did nothing: the camera turned on but no video
appeared, no scanning happened, and the handshake never completed, so the
connection timed out to `Error`.

Root cause (a latent 2b.2 bug, never caught because the camera path's manual
QA was never performed): `handleStartScan` read `videoRef.current` while the
pair state was still `'showing-offer'`. The `<video>` element only renders
in the `'scanning-answer'` state (`QrPanel`), so the ref was `null` and the
handler **early-returned before** `setQrState('scanning-answer')` and
`scheduleScan()`. The `getUserMedia` stream was acquired (camera LED on) but
never attached and never scanned.

## Fix

- `handleStartScan` now acquires the stream, stores it in `streamRef`, and
  sets `'scanning-answer'`. A new effect (keyed on `qrState`) attaches the
  stream to the `<video>` and starts the jsQR loop **once the element is
  mounted** — eliminating the null-ref ordering hazard.
- **Higher capture resolution** (`width/height ideal 1280×720`): the webcam
  default (~640×480) renders the dense answer QR's modules below one pixel,
  so jsQR could never decode even when scanning *was* running. This is the
  decode-reliability half of the fix.
- **Scanning feedback** (`data-testid="scan-status"`): a live
  frames-checked counter + a pointer to the manual-pairing fallback, so the
  operator can tell the camera is actively working (the absence of any
  feedback was the user's explicit complaint).

## Notes

- The reverse-QR-over-webcam path is inherently finicky (a webcam reading a
  phone-screen QR). The manual-paste fallback remains the reliable escape
  hatch and is now called out in the scan-status hint.
- Real webcam decode → `connected` stays a manual gate (§B2): Chromium's
  fake camera emits a synthetic pattern, not a decodable QR, so the
  automated check (`verify-phase-2b6.mjs` C1) gates only that scanning
  *starts* (state transition + video mount + frame counter advancing) —
  exactly the regression. It would fail before this fix.
