import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { parsePhoneFragment } from './pair-url'
import { createPeer, type PeerHandle, type PeerState } from './peer'
import { tryDecodeOffer, tryEncodeOffer } from './qr'

export type PhoneMode = 'qr' | 'manual'

export function PhoneApp() {
  const peerRef = useRef<PeerHandle | null>(null)
  const answerQrRef = useRef<HTMLCanvasElement | null>(null)

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
  }, [initialOfferPayload])

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
        <h2>Send a commit</h2>
        <p>
          Status: <strong data-testid="phone-state">{state}</strong>
        </p>
        <button
          type="button"
          className="primary"
          onClick={handleSendCommit}
          disabled={state !== 'connected'}
        >
          Send commit
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
