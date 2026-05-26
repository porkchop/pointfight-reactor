import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { parsePhoneFragment } from './pair-url'
import { createPeer, type PeerHandle, type PeerState } from './peer'
import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_THRESHOLD_G,
  G,
  type MotionSample,
} from './motion'
import {
  createMotionRunner,
  type MotionRunner,
  type RunnerMode,
} from './motion-runner'
import { tryDecodeOffer, tryEncodeOffer } from './qr'
import type { PhoneMessage } from './wire'

export type PhoneMode = 'qr' | 'manual'
export type MotionStatus = 'off' | 'pending' | 'on' | 'denied' | 'unsupported'

interface DeviceMotionEventConstructor {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
}

function deviceMotionEventCtor(): DeviceMotionEventConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    DeviceMotionEvent?: DeviceMotionEventConstructor
  }
  return w.DeviceMotionEvent ?? null
}

function nowMs(): number {
  // Monotonic clock so wall-clock jumps (NTP / DST) cannot make a sample
  // timestamp move backward and trip the debounce permanently. Falls back
  // to Date.now() in environments without performance.now (none today,
  // but the cost of the guard is zero).
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function toMotionSample(ev: DeviceMotionEvent): MotionSample | null {
  // Prefer gravity-removed linear acceleration when the device exposes it.
  // Both Android Chrome and iOS Safari populate `acceleration`; the
  // includesGravity branch covers the rare device that only fills
  // `accelerationIncludingGravity` (then subtract a crude 1-g Z offset).
  const a = ev.acceleration
  if (a && (a.x !== null || a.y !== null || a.z !== null)) {
    return {
      ax: a.x ?? 0,
      ay: a.y ?? 0,
      az: a.z ?? 0,
      t: nowMs(),
    }
  }
  const ag = ev.accelerationIncludingGravity
  if (!ag) return null
  return {
    ax: ag.x ?? 0,
    ay: ag.y ?? 0,
    az: (ag.z ?? 0) - G,
    t: nowMs(),
  }
}

export function PhoneApp() {
  const peerRef = useRef<PeerHandle | null>(null)
  const answerQrRef = useRef<HTMLCanvasElement | null>(null)
  const motionRunnerRef = useRef<MotionRunner | null>(null)
  const motionListenerRef = useRef<((ev: DeviceMotionEvent) => void) | null>(
    null,
  )

  const [initialOfferPayload] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : parsePhoneFragment(window.location.hash ?? '').offer,
  )

  const [state, setState] = useState<PeerState>('idle')
  const [mode, setMode] = useState<PhoneMode>(
    initialOfferPayload ? 'qr' : 'manual',
  )
  const [offerText, setOfferText] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [answerPayload, setAnswerPayload] = useState<string | null>(null)
  const [autoFallbackReason, setAutoFallbackReason] = useState<string | null>(
    null,
  )
  const [fragmentDone, setFragmentDone] = useState<boolean>(
    !initialOfferPayload,
  )
  const [err, setErr] = useState<string | null>(null)
  const [lastCommitAt, setLastCommitAt] = useState<number | null>(null)
  const [motionStatus, setMotionStatus] = useState<MotionStatus>('off')
  const [runnerMode, setRunnerMode] = useState<RunnerMode>('armed')
  const [lastPeakG, setLastPeakG] = useState<number | null>(null)
  const [motionDenied, setMotionDenied] = useState<string | null>(null)

  const ensureRunner = useCallback((): MotionRunner => {
    if (motionRunnerRef.current) return motionRunnerRef.current
    const runner = createMotionRunner({
      thresholdG: DEFAULT_THRESHOLD_G,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      mode: 'armed',
    })
    motionRunnerRef.current = runner
    return runner
  }, [])

  const handlePeerMessage = useCallback(
    (m: PhoneMessage) => {
      if (m.type !== 'config') return
      // Laptop hands us the per-athlete threshold + mode. setConfig resets
      // the debounce so the next swing under the new threshold fires
      // immediately (important after the laptop flips us from calibrating
      // back to armed).
      ensureRunner().setConfig({
        thresholdG: m.thresholdG,
        debounceMs: m.debounceMs,
        mode: m.mode,
      })
      setRunnerMode(m.mode)
    },
    [ensureRunner],
  )

  const detachMotionListener = useCallback((): void => {
    if (motionListenerRef.current && typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', motionListenerRef.current)
    }
    motionListenerRef.current = null
  }, [])

  const attachMotionListener = useCallback((): void => {
    if (motionListenerRef.current) return
    if (typeof window === 'undefined') return
    const listener = (ev: DeviceMotionEvent) => {
      const sample = toMotionSample(ev)
      if (!sample) return
      const runner = ensureRunner()
      const msg = runner.push(sample)
      if (!msg) return
      if (msg.type === 'sample') setLastPeakG(msg.peakG)
      try {
        peerRef.current?.send(msg)
        if (msg.type === 'commit') setLastCommitAt(msg.t)
      } catch {
        // Peer closed / not-yet-open: drop the event. The athlete cares
        // about the most recent commit, not a backlog accumulated while
        // disconnected.
      }
    }
    motionListenerRef.current = listener
    window.addEventListener('devicemotion', listener)
  }, [ensureRunner])

  const handleEnableMotion = useCallback(async (): Promise<void> => {
    setMotionDenied(null)
    setErr(null)
    setMotionStatus('pending')
    const ctor = deviceMotionEventCtor()
    if (!ctor) {
      setMotionStatus('unsupported')
      setMotionDenied(
        'This device exposes no DeviceMotionEvent — motion commit is unavailable.',
      )
      return
    }
    if (typeof ctor.requestPermission === 'function') {
      try {
        const result = await ctor.requestPermission()
        if (result !== 'granted') {
          setMotionStatus('denied')
          setMotionDenied(
            'Motion permission was denied. On iOS this can be re-enabled in Settings → Safari → Motion & Orientation Access.',
          )
          return
        }
      } catch (e) {
        setMotionStatus('denied')
        setMotionDenied(
          `Could not request motion permission (${e instanceof Error ? e.message : String(e)}).`,
        )
        return
      }
    }
    ensureRunner()
    attachMotionListener()
    setMotionStatus('on')
  }, [attachMotionListener, ensureRunner])

  useEffect(() => {
    if (!initialOfferPayload) return
    let cancelled = false
    void (async () => {
      const dec = await tryDecodeOffer(initialOfferPayload)
      if (cancelled) return
      if (!dec.ok) {
        setMode('manual')
        setAutoFallbackReason(
          dec.reason === 'b64'
            ? 'QR payload could not be read — paste the offer manually.'
            : dec.reason === 'gzip'
              ? 'QR payload could not be decompressed — paste the offer manually.'
              : 'QR payload was empty — paste the offer manually.',
        )
        setFragmentDone(true)
        return
      }
      try {
        const peer = createPeer()
        peerRef.current = peer
        peer.onStateChange(setState)
        peer.onMessage(handlePeerMessage)
        const answerSdp = await peer.acceptOffer(dec.sdp)
        if (cancelled) return
        setAnswerText(answerSdp)
        const enc = await tryEncodeOffer(answerSdp)
        if (cancelled) return
        if (!enc.ok) {
          setMode('manual')
          setAutoFallbackReason(
            `Answer SDP is too large for one QR (${enc.byteLength} bytes) — copy it manually.`,
          )
          setFragmentDone(true)
          return
        }
        setAnswerPayload(enc.payload)
        setFragmentDone(true)
      } catch (e) {
        if (cancelled) return
        setMode('manual')
        setAutoFallbackReason(
          `Could not apply offer from QR (${e instanceof Error ? e.message : String(e)}) — paste it manually.`,
        )
        setFragmentDone(true)
      }
    })()
    return () => {
      cancelled = true
      peerRef.current?.close()
    }
  }, [initialOfferPayload, handlePeerMessage])

  // Always-on cleanup for the devicemotion listener — registration happens
  // from the user's "Enable motion sensor" click, which is independent of
  // the QR-vs-manual pairing flow. The QR-flow effect above early-returns
  // in the manual case, so it cannot own this teardown.
  useEffect(() => {
    return () => {
      detachMotionListener()
    }
  }, [detachMotionListener])

  useEffect(() => {
    if (!answerPayload) return
    const canvas = answerQrRef.current
    if (!canvas) return
    void QRCode.toCanvas(canvas, answerPayload, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'L',
    }).catch((e: unknown) => {
      setErr(e instanceof Error ? e.message : String(e))
    })
  }, [answerPayload])

  async function handleAcceptOffer(): Promise<void> {
    setErr(null)
    if (!offerText.trim()) {
      setErr('Paste the offer SDP from the laptop first.')
      return
    }
    if (peerRef.current) {
      setErr('Already paired this session — reload the page to start over.')
      return
    }
    try {
      const peer = createPeer()
      peerRef.current = peer
      peer.onStateChange(setState)
      peer.onMessage(handlePeerMessage)
      const answer = await peer.acceptOffer(offerText)
      setAnswerText(answer)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function handleSendCommit(): void {
    setErr(null)
    const peer = peerRef.current
    if (!peer || state !== 'connected') {
      setErr('Not connected yet.')
      return
    }
    const t = Date.now()
    try {
      peer.send({ type: 'commit', t })
      setLastCommitAt(t)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="screen phone-app">
      <header>
        <h1>PointFight Phone Sensor</h1>
        <p className="hint">
          {mode === 'qr'
            ? 'QR pairing (Phase 2b.2). Show this screen to the laptop’s webcam.'
            : 'Manual pairing fallback.'}
        </p>
      </header>

      <div className="profile-actions">
        <button
          type="button"
          className="link"
          onClick={() => setMode((m) => (m === 'qr' ? 'manual' : 'qr'))}
          aria-label="toggle phone mode"
        >
          {mode === 'qr' ? 'Show manual paste' : 'Back to QR'}
        </button>
      </div>

      {autoFallbackReason && mode === 'manual' && (
        <div className="banner info" role="status" data-testid="phone-fallback">
          {autoFallbackReason}
        </div>
      )}

      {mode === 'qr' && fragmentDone && answerPayload && (
        <section className="settings-section">
          <h2>Show this QR to the laptop</h2>
          <canvas ref={answerQrRef} data-testid="answer-qr" />
          <p className="hint">
            The laptop's webcam will scan this to complete pairing.
          </p>
        </section>
      )}

      {mode === 'qr' && fragmentDone && !answerPayload && (
        <section className="settings-section">
          <p className="hint" data-testid="qr-pending">
            Open this page via the laptop's offer QR (URL contains{' '}
            <code>#offer=…</code>) to generate an answer QR.
          </p>
        </section>
      )}

      {mode === 'manual' && (
        <>
          <section className="settings-section">
            <h2>1. Paste the offer SDP from the laptop</h2>
            <textarea
              aria-label="offer SDP"
              rows={6}
              value={offerText}
              onChange={(e) => setOfferText(e.target.value)}
              placeholder="v=0…"
            />
            <button
              type="button"
              className="primary"
              onClick={() => void handleAcceptOffer()}
              disabled={state !== 'idle' && state !== 'error'}
            >
              Generate answer
            </button>
          </section>

          <section className="settings-section">
            <h2>2. Copy this answer back to the laptop</h2>
            <textarea
              aria-label="answer SDP"
              rows={6}
              value={answerText}
              readOnly
              placeholder="(generated after step 1)"
            />
          </section>
        </>
      )}

      <section className="settings-section">
        <h2>Motion sensor</h2>
        <p>
          Status:{' '}
          <strong data-testid="motion-status">{motionStatus}</strong>
          {motionStatus === 'on' && (
            <>
              {' '}(<span data-testid="motion-mode">{runnerMode}</span>)
            </>
          )}
        </p>
        {motionStatus !== 'on' && motionStatus !== 'unsupported' && (
          <button
            type="button"
            className="primary"
            onClick={() => void handleEnableMotion()}
            aria-label="enable motion sensor"
          >
            Enable motion sensor
          </button>
        )}
        {motionDenied && (
          <div
            className="banner warn"
            role="alert"
            data-testid="motion-denied"
          >
            {motionDenied}
          </div>
        )}
        {motionStatus === 'on' && lastPeakG !== null && (
          <p className="hint">
            Last detected peak:{' '}
            <strong data-testid="last-peak-g">{lastPeakG.toFixed(2)}</strong> g
          </p>
        )}
        <p className="hint">
          Once the motion sensor is on, the phone sends commits over the
          DataChannel automatically — you can stop using the manual button
          below.
        </p>
      </section>

      <section className="settings-section">
        <h2>Send a commit</h2>
        <p>
          Connection: <strong data-testid="phone-state">{state}</strong>
        </p>
        <button
          type="button"
          className="primary"
          onClick={handleSendCommit}
          disabled={state !== 'connected'}
        >
          Send commit (manual)
        </button>
        {lastCommitAt !== null && (
          <p className="hint">Last commit sent at {lastCommitAt}</p>
        )}
      </section>

      {err && (
        <div className="banner warn" role="alert">
          {err}
        </div>
      )}
    </div>
  )
}
