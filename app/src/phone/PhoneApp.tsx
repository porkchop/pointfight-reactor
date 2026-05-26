import { useEffect, useRef, useState } from 'react'
import { createPeer, type PeerHandle, type PeerState } from './peer'

export function PhoneApp() {
  const peerRef = useRef<PeerHandle | null>(null)
  const [state, setState] = useState<PeerState>('idle')
  const [offerText, setOfferText] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [lastCommitAt, setLastCommitAt] = useState<number | null>(null)

  useEffect(() => {
    return () => {
      peerRef.current?.close()
    }
  }, [])

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
        <p className="hint">Phase 2b.1 — manual pairing. Replace with QR in 2b.2.</p>
      </header>

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

      <section className="settings-section">
        <h2>3. Send a commit</h2>
        <p>Status: <strong data-testid="phone-state">{state}</strong></p>
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

      {err && <div className="banner warn" role="alert">{err}</div>}
    </div>
  )
}
