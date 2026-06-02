import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { createPeer, type PeerHandle, type PeerState } from '../phone/peer'
import { buildPhoneUrl } from '../phone/pair-url'
import { fitsSingleQr, tryDecodeOffer, tryEncodeOffer } from '../phone/qr'
import type { PhoneMessage } from '../phone/wire'
import { loadActiveProfile, loadSettings } from '../store/settings'
import { DEFAULT_DEBOUNCE_MS, getActiveThresholdG } from '../phone/motion'
import type { ProfileRecord } from '../store/profiles'
import {
  attachPhonePeer,
  detachPhonePeer,
  getActivePhonePeer,
} from '../store/phone-peer'
import { CalibrateScreen } from './CalibrateScreen'

interface PairScreenProps {
  onClose: () => void
  /** Override `navigator.mediaDevices.getUserMedia` for tests. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
}

export type PairMode = 'qr' | 'manual'
export type PairQrState =
  | 'preparing-offer'
  | 'showing-offer'
  | 'scanning-answer'
  | 'connected'
  | 'error'

// How long to wait for the DataChannel after the handshake is in flight
// before showing the same-network diagnostic. ICE failure typically
// surfaces within ~10–15s; 20s leaves margin without feeling stuck.
const CONNECT_TIMEOUT_MS = 20_000

/**
 * Phase 2b.2 — laptop-side pairing.
 *
 * QR mode is the default: the laptop renders an offer QR containing
 * `…/phone#offer=<compressed-sdp>`. The user scans it with their phone,
 * the phone renders an answer QR, and the laptop's webcam decodes that
 * answer to complete the handshake.
 *
 * Manual mode is the 2b.1 textarea fallback. It auto-activates when the
 * webcam is denied/unavailable or when the SDP is too big for one QR.
 */
export function PairScreen({ onClose, getUserMedia }: PairScreenProps) {
  const peerRef = useRef<PeerHandle | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const scanRafRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // PairScreen-local listeners must outlive the peer creation hop but be
  // detached on unmount (or when re-binding to a different peer). Without
  // this we'd stack a fresh pair of listeners on every reopen.
  const offStateRef = useRef<(() => void) | null>(null)
  const offMsgRef = useRef<(() => void) | null>(null)

  const [mode, setMode] = useState<PairMode>('qr')
  const [qrState, setQrState] = useState<PairQrState>('preparing-offer')
  const [peerState, setPeerState] = useState<PeerState>('idle')
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null)
  const [lanIp, setLanIp] = useState<string | null>(null)
  const [offerSdp, setOfferSdp] = useState('')
  const [answerSdp, setAnswerSdp] = useState('')
  const [autoFallbackReason, setAutoFallbackReason] = useState<string | null>(
    null,
  )
  const [err, setErr] = useState<string | null>(null)
  const [connectTimedOut, setConnectTimedOut] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [lastCommit, setLastCommit] = useState<{
    receivedAt: number
    sentAt: number
  } | null>(null)
  const [activeProfile, setActiveProfile] = useState<ProfileRecord | null>(null)

  // --- Setup: load settings, create peer, generate offer, attempt QR ---
  useEffect(() => {
    let cancelled = false

    function unbindLocal(): void {
      offStateRef.current?.()
      offMsgRef.current?.()
      offStateRef.current = null
      offMsgRef.current = null
    }

    function bindLocal(
      peer: PeerHandle,
      profile: ProfileRecord,
      sendArmedOnConnect: boolean,
    ): void {
      unbindLocal()
      offStateRef.current = peer.onStateChange((next) => {
        if (cancelled) return
        setPeerState(next)
        if (next === 'connected') {
          setQrState('connected')
          // Reset the RTT baseline so "Last commit received at +Xms" is the
          // pure phone→laptop send time the M5 manual gate budgets at <200ms.
          setStartedAt(Date.now())
          if (sendArmedOnConnect) {
            // Hand the phone the per-athlete threshold so the motion runner
            // (Phase 2b.3) arms with the right value the moment the
            // DataChannel opens. Only fire on the create-new-peer branch;
            // the reuse branch enters with the peer already configured.
            try {
              peer.send({
                type: 'config',
                thresholdG: getActiveThresholdG(profile),
                debounceMs: DEFAULT_DEBOUNCE_MS,
                mode: 'armed',
              })
            } catch {
              /* peer not actually open yet — phone defaults to armed anyway */
            }
          }
        }
      })
      offMsgRef.current = peer.onMessage((m: PhoneMessage) => {
        if (cancelled) return
        if (m.type === 'commit') {
          setLastCommit({ receivedAt: Date.now(), sentAt: m.t })
        }
      })
    }

    void (async () => {
      const [s, profile] = await Promise.all([
        loadSettings(),
        loadActiveProfile(),
      ])
      if (cancelled) return
      const ip = s.laptopLanIp?.trim() ?? ''
      setLanIp(ip || null)
      setActiveProfile(profile)

      // Reuse an in-flight or connected peer so the athlete can reopen
      // PairScreen (e.g. to recalibrate, to inspect status) without tearing
      // down their pairing. Per decision-memo §2b.4, the peer's lifetime is
      // owned by the phone-peer slice, not by PairScreen's mount.
      const existing = getActivePhonePeer()
      if (existing && existing.state !== 'closed' && existing.state !== 'error') {
        peerRef.current = existing
        bindLocal(existing, profile, false)
        setPeerState(existing.state)
        if (existing.state === 'connected') {
          setQrState('connected')
          setStartedAt(Date.now())
        }
        return
      }

      const peer = createPeer()
      peerRef.current = peer
      attachPhonePeer(peer)
      bindLocal(peer, profile, true)

      setStartedAt(Date.now())
      try {
        const sdp = await peer.createOffer()
        if (cancelled) return
        setOfferSdp(sdp)
        const enc = await tryEncodeOffer(sdp)
        if (!enc.ok) {
          setMode('manual')
          setAutoFallbackReason(
            `Pairing payload (${enc.byteLength} bytes) is too large for one QR — using manual paste.`,
          )
          setQrState('showing-offer')
          return
        }
        // Phase 2b.5: derive the phone URL from the laptop's current
        // origin + base path so the phone loads the same deployment
        // (Pages, LAN dev, …). `buildPhoneUrl` only needs the LAN IP when
        // the laptop is on loopback; it returns null in that case if no IP
        // is set, which is the one branch that still requires manual paste.
        const url = buildPhoneUrl(window.location, ip || null, enc.payload)
        if (!url) {
          setMode('manual')
          setAutoFallbackReason(
            'Set your laptop’s LAN IP in Settings to enable QR pairing from a local dev server. Using manual paste.',
          )
          setQrState('showing-offer')
          return
        }
        // The QR encodes the whole URL, not just the payload (2b.5). A long
        // origin/base-path prefix can push an otherwise-fine SDP over the
        // single-QR ceiling — check the assembled URL, not enc.byteLength.
        if (!fitsSingleQr(url)) {
          setMode('manual')
          setAutoFallbackReason(
            `Pairing URL (${url.length} chars) is too long for one QR — using manual paste.`,
          )
          setQrState('showing-offer')
          return
        }
        setPhoneUrl(url)
        setQrState('showing-offer')
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        setQrState('error')
      }
    })()
    return () => {
      cancelled = true
      stopScanning()
      unbindLocal()
      // Peer lifetime is owned by the phone-peer slice, not PairScreen —
      // closing here would tear down a pairing the athlete needs to drill
      // with. Explicit disconnect is exposed via `handleDisconnect`.
    }
  }, [])

  function handleDisconnect(): void {
    offStateRef.current?.()
    offMsgRef.current?.()
    offStateRef.current = null
    offMsgRef.current = null
    detachPhonePeer()
    peerRef.current = null
    setPeerState('idle')
    setQrState('preparing-offer')
    setOfferSdp('')
    setAnswerSdp('')
    setPhoneUrl(null)
    setLastCommit(null)
    setStartedAt(null)
    setConnectTimedOut(false)
  }

  // --- Surface a diagnostic if the P2P connection never establishes ---
  // The phone page can load fine (esp. from a public host) while the
  // WebRTC DataChannel silently fails to connect — both ends must reach
  // each other directly (same Wi-Fi, no client/guest isolation); there is
  // no TURN relay. Show actionable guidance instead of an indefinite wait.
  useEffect(() => {
    // Only arm once the handshake is actually in flight and not yet
    // connected: the laptop has shown its offer (and likely scanned the
    // answer) or the peer reports it is connecting. The render guards the
    // banner on `peerState !== 'connected'`, so a later success hides it
    // without needing a synchronous reset here.
    const inFlight =
      peerState !== 'connected' &&
      (qrState === 'scanning-answer' ||
        peerState === 'connecting' ||
        peerState === 'gathering_answer')
    if (!inFlight) return
    const id = setTimeout(() => setConnectTimedOut(true), CONNECT_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [peerState, qrState])

  // --- Draw the offer QR onto its canvas once we have a phoneUrl ---
  useEffect(() => {
    if (!phoneUrl) return
    const canvas = qrCanvasRef.current
    if (!canvas) return
    void QRCode.toCanvas(canvas, phoneUrl, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'L',
    }).catch((e: unknown) => {
      setErr(e instanceof Error ? e.message : String(e))
    })
  }, [phoneUrl])

  function stopScanning(): void {
    if (scanRafRef.current !== null) {
      cancelAnimationFrame(scanRafRef.current)
      scanRafRef.current = null
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
      streamRef.current = null
    }
  }

  async function handleStartScan(): Promise<void> {
    setErr(null)
    const gum =
      getUserMedia ??
      navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices)
    if (!gum) {
      setMode('manual')
      setAutoFallbackReason('No camera available — use manual pairing below.')
      return
    }
    let stream: MediaStream
    try {
      stream = await gum({ video: { facingMode: 'user' } })
    } catch (e) {
      setMode('manual')
      setAutoFallbackReason(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera blocked — use manual pairing below.'
          : `Camera unavailable (${e instanceof Error ? e.message : String(e)}) — use manual pairing below.`,
      )
      return
    }
    streamRef.current = stream
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    await video.play().catch(() => {})
    setQrState('scanning-answer')
    scheduleScan()
  }

  function scheduleScan(): void {
    if (scanRafRef.current !== null) return
    // Decision memo §"jsqr scan loop" budgets ~10 fps. raf would run ~60.
    let lastDecodeAt = 0
    const decodeIntervalMs = 100
    const tick = () => {
      scanRafRef.current = null
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) return
      const now = performance.now()
      if (now - lastDecodeAt < decodeIntervalMs) {
        scanRafRef.current = requestAnimationFrame(tick)
        return
      }
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) {
        scanRafRef.current = requestAnimationFrame(tick)
        return
      }
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, w, h)
      const image = ctx.getImageData(0, 0, w, h)
      lastDecodeAt = now
      const result = jsQR(image.data, w, h)
      if (result && result.data) {
        void handleDecodedAnswer(result.data)
        return
      }
      scanRafRef.current = requestAnimationFrame(tick)
    }
    scanRafRef.current = requestAnimationFrame(tick)
  }

  async function handleDecodedAnswer(payload: string): Promise<void> {
    const dec = await tryDecodeOffer(payload)
    if (!dec.ok) {
      // Any QR in the camera's view lands here (stickers, screensavers,
      // wifi-config QRs). Resume the scan loop so the operator doesn't
      // have to reload to retry.
      scheduleScan()
      return
    }
    stopScanning()
    setAnswerSdp(dec.sdp)
    try {
      await peerRef.current?.acceptAnswer(dec.sdp)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      // Decoded payload was wire-valid but the SDP was junk. Re-enter the
      // scan loop instead of dead-ending — the user can re-point at the
      // phone or fall back to manual pairing from the toggle.
      setQrState('showing-offer')
      void handleStartScan()
    }
  }

  async function handleManualAcceptAnswer(): Promise<void> {
    setErr(null)
    if (!answerSdp.trim()) {
      setErr('Paste the answer SDP from the phone.')
      return
    }
    try {
      await peerRef.current?.acceptAnswer(answerSdp)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function toggleMode(): void {
    setMode((m) => {
      if (m === 'qr') stopScanning()
      return m === 'qr' ? 'manual' : 'qr'
    })
  }

  const sinceStart =
    startedAt !== null && lastCommit
      ? lastCommit.receivedAt - startedAt
      : null

  return (
    <div className="screen pair-screen">
      <header className="settings-header">
        <h1>Pair phone</h1>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </header>

      <p className="hint">
        QR pairing (Phase 2b.2). Manual paste remains available as a fallback.
      </p>

      <div className="profile-actions">
        <button
          type="button"
          className="link"
          onClick={toggleMode}
          aria-label="toggle pair mode"
        >
          {mode === 'qr' ? 'Show manual pairing' : 'Back to QR pairing'}
        </button>
      </div>

      {autoFallbackReason && mode === 'manual' && (
        <div className="banner info" role="status">
          {autoFallbackReason}
        </div>
      )}

      {mode === 'qr' ? (
        <QrPanel
          qrState={qrState}
          phoneUrl={phoneUrl}
          qrCanvasRef={qrCanvasRef}
          videoRef={videoRef}
          canvasRef={canvasRef}
          onStartScan={() => void handleStartScan()}
        />
      ) : (
        <ManualPanel
          phoneUrl={phoneUrlForManual(lanIp)}
          offerSdp={offerSdp}
          answerSdp={answerSdp}
          peerState={peerState}
          onAnswerChange={setAnswerSdp}
          onAccept={() => void handleManualAcceptAnswer()}
        />
      )}

      <section className="settings-section">
        <h2>Status</h2>
        <p>
          Connection: <strong data-testid="pair-state">{qrState}</strong>{' '}
          (peer: <span data-testid="peer-state">{peerState}</span>)
        </p>
        {lastCommit && (
          <p data-testid="last-commit">
            Last commit received at +{sinceStart}ms (phone clock t=
            {lastCommit.sentAt}).
          </p>
        )}
        {peerState === 'connected' && (
          <button
            type="button"
            className="link"
            onClick={handleDisconnect}
            aria-label="disconnect phone"
          >
            Disconnect phone
          </button>
        )}
        {(connectTimedOut || peerState === 'error') &&
          peerState !== 'connected' && (
            <div
              className="banner warn"
              role="status"
              data-testid="connect-timeout"
            >
              The phone opened the page, but the two devices haven’t
              connected. The data link is peer-to-peer over your local
              network (no relay server), so both devices must be on the{' '}
              <strong>same Wi-Fi</strong> with{' '}
              <strong>guest / client isolation turned off</strong>. Phones on
              mobile data or a different network can’t pair.
            </div>
          )}
      </section>

      {peerState === 'connected' && activeProfile && peerRef.current && (
        <CalibrateScreen
          peer={peerRef.current}
          profile={activeProfile}
          onSaved={setActiveProfile}
        />
      )}

      {err && (
        <div className="banner warn" role="alert">
          {err}
        </div>
      )}
    </div>
  )
}

function QrPanel({
  qrState,
  phoneUrl,
  qrCanvasRef,
  videoRef,
  canvasRef,
  onStartScan,
}: {
  qrState: PairQrState
  phoneUrl: string | null
  qrCanvasRef: React.RefObject<HTMLCanvasElement | null>
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onStartScan: () => void
}) {
  return (
    <>
      <section className="settings-section">
        <h2>1. Scan with your phone</h2>
        {phoneUrl ? (
          <>
            <canvas ref={qrCanvasRef} data-testid="offer-qr" />
            <p className="hint">
              Or open <code data-testid="phone-url">{phoneUrl}</code> manually.
            </p>
          </>
        ) : (
          <p className="hint" data-testid="qr-pending">
            Preparing offer…
          </p>
        )}
      </section>

      <section className="settings-section">
        <h2>2. Scan the phone's reply</h2>
        {qrState === 'scanning-answer' || qrState === 'connected' ? (
          <>
            <video
              ref={videoRef}
              data-testid="answer-video"
              playsInline
              muted
              style={{ maxWidth: 320 }}
            />
            <canvas
              ref={canvasRef}
              data-testid="answer-canvas"
              style={{ display: 'none' }}
            />
          </>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={onStartScan}
            disabled={qrState !== 'showing-offer'}
            aria-label="start scan"
          >
            I scanned the QR — turn on camera
          </button>
        )}
      </section>
    </>
  )
}

function ManualPanel({
  phoneUrl,
  offerSdp,
  answerSdp,
  peerState,
  onAnswerChange,
  onAccept,
}: {
  phoneUrl: string | null
  offerSdp: string
  answerSdp: string
  peerState: PeerState
  onAnswerChange: (v: string) => void
  onAccept: () => void
}) {
  return (
    <>
      <section className="settings-section">
        <h2>1. Open the phone companion page</h2>
        {phoneUrl ? (
          <p>
            On your phone, open <code data-testid="phone-url">{phoneUrl}</code>.
          </p>
        ) : (
          <p className="hint">
            Set your laptop's LAN IP in Settings to see the phone URL here.
          </p>
        )}
      </section>

      <section className="settings-section">
        <h2>2. Offer SDP (copy onto the phone)</h2>
        <textarea
          aria-label="offer SDP"
          rows={6}
          value={offerSdp}
          readOnly
          placeholder="(generating…)"
        />
      </section>

      <section className="settings-section">
        <h2>3. Paste the phone's answer SDP</h2>
        <textarea
          aria-label="answer SDP"
          rows={6}
          value={answerSdp}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="v=0…"
        />
        <button
          type="button"
          className="primary"
          onClick={onAccept}
          disabled={peerState !== 'awaiting_answer'}
        >
          Connect
        </button>
      </section>
    </>
  )
}

function phoneUrlForManual(lanIp: string | null): string | null {
  // Phase 2b.5: mirror the laptop's origin + base path; only a loopback
  // dev host needs the LAN IP (and returns null without one).
  return buildPhoneUrl(window.location, lanIp, null)
}
