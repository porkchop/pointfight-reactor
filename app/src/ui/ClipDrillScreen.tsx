import { useCallback, useEffect, useRef } from 'react'
import { useClipRunner } from '../clipmode/runner'
import { usePhonePeer } from '../store/phone-peer'
import { CueStage } from './CueStage'
import { CUE_LIBRARY } from '../cues/library'
import type { RepResult } from '../engine/types'

const FEEDBACK_HOLD_MS = 1000

interface ClipDrillScreenProps {
  commitKeyCode: string
  commitKeyLabel: string
}

interface RvfcMetadata {
  mediaTime: number
}

type RvfcCallback = (now: number, metadata: RvfcMetadata) => void

interface VideoMaybeRvfc {
  requestVideoFrameCallback?: (cb: RvfcCallback) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

function asMaybeRvfc(v: HTMLVideoElement | null): VideoMaybeRvfc | null {
  return v as unknown as VideoMaybeRvfc | null
}

export function ClipDrillScreen({
  commitKeyCode,
  commitKeyLabel,
}: ClipDrillScreenProps) {
  const phase = useClipRunner((s) => s.phase)
  const currentClip = useClipRunner((s) => s.currentClip)
  const playSeq = useClipRunner((s) => s.playSeq)
  const feedback = useClipRunner((s) => s.feedback)
  const reps = useClipRunner((s) => s.reps)
  const inputSource = useClipRunner((s) => s.inputSource)
  const config = useClipRunner((s) => s.config)
  const markClipStarted = useClipRunner((s) => s.markClipStarted)
  const markCueShown = useClipRunner((s) => s.markCueShown)
  const recordPress = useClipRunner((s) => s.recordPress)
  const finishWindow = useClipRunner((s) => s.finishWindow)
  const acknowledgeFeedback = useClipRunner((s) => s.acknowledgeFeedback)
  const stop = useClipRunner((s) => s.stop)
  const phoneStatus = usePhonePeer((s) => s.status)

  const videoRef = useRef<HTMLVideoElement>(null)
  const blobUrlRef = useRef<string | null>(null)
  const phaseRef = useRef(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const dispatchCommit = useCallback(
    (at: number) => {
      const p = phaseRef.current
      if (p === 'precue' || p === 'showing') {
        recordPress(at)
      } else if (p === 'feedback') {
        acknowledgeFeedback()
      }
    },
    [recordPress, acknowledgeFeedback],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === commitKeyCode) {
        e.preventDefault()
        dispatchCommit(performance.now())
      } else if (e.key === 'Escape') {
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commitKeyCode, dispatchCommit, stop])

  useEffect(() => {
    if (inputSource !== 'phone') return
    return usePhonePeer.getState().onCommit((c) => dispatchCommit(c.receivedAt))
  }, [inputSource, dispatchCommit])

  // Blob URL effect: keyed on the CLIP id only so we don't churn the
  // object URL when only `playSeq` changes (single-clip pool rep 2+).
  // Mirrors ClipTagScreen's effect shape; cleanup revokes the URL.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !currentClip) return
    let url: string
    try {
      url = URL.createObjectURL(currentClip.blob)
    } catch {
      return
    }
    blobUrlRef.current = url
    v.src = url
    return () => {
      URL.revokeObjectURL(url)
      blobUrlRef.current = null
    }
  }, [currentClip?.id, currentClip])

  // Rewind + play effect: re-fires on every new precue rep, including
  // single-clip pools where the same clip is selected back-to-back
  // (closes code-reviewer B1). Keyed on `playSeq` from the runner so
  // each `selectNextClip()` triggers a fresh rewind + play, even when
  // `currentClip.id` is unchanged.
  useEffect(() => {
    if (phase !== 'precue') return
    const v = videoRef.current
    if (!v || !currentClip) return
    try {
      v.currentTime = 0
    } catch {
      /* video may not have metadata yet; the rvfc loop still fires once it does */
    }
    void v.play().catch(() => {
      /* play() can reject if the browser blocks autoplay; the rvfc
         loop still fires once play eventually starts. */
    })
  }, [phase, playSeq, currentClip])

  // Schedule rvfc to detect when the playhead crosses `cueAtMs`. Per §B5,
  // requestVideoFrameCallback is the only path to ±33 ms precision; this
  // hook only runs when the prototype shipped it (gated upstream by
  // `isClipModeSupported()`).
  useEffect(() => {
    if (phase !== 'precue' || !currentClip) return
    const rvfc = asMaybeRvfc(videoRef.current)
    if (!rvfc || typeof rvfc.requestVideoFrameCallback !== 'function') return
    const target = currentClip.cueAtMs ?? 0
    let cancelled = false
    let handle: number | null = null
    const tick: RvfcCallback = (_now, metadata) => {
      if (cancelled) return
      if (metadata.mediaTime * 1000 >= target) {
        markCueShown(performance.now())
        return
      }
      handle = rvfc.requestVideoFrameCallback!(tick)
    }
    handle = rvfc.requestVideoFrameCallback(tick)
    return () => {
      cancelled = true
      if (
        handle !== null &&
        typeof rvfc.cancelVideoFrameCallback === 'function'
      ) {
        rvfc.cancelVideoFrameCallback(handle)
      }
    }
  }, [phase, currentClip, markCueShown])

  // Auto-finish the response window once cueShownAt has been set and the
  // configured responseWindowMs elapses with no press.
  useEffect(() => {
    if (phase !== 'showing') return
    const timer = window.setTimeout(finishWindow, config.responseWindowMs)
    return () => window.clearTimeout(timer)
  }, [phase, config.responseWindowMs, finishWindow])

  useEffect(() => {
    if (phase !== 'feedback') return
    const timer = window.setTimeout(acknowledgeFeedback, FEEDBACK_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [phase, acknowledgeFeedback])

  const phoneDropped =
    inputSource === 'phone' && phoneStatus !== 'connected'

  const cue =
    currentClip?.cueId !== undefined
      ? CUE_LIBRARY.find((c) => c.id === currentClip.cueId) ?? null
      : null

  return (
    <div
      className={`screen trainer clip-drill trainer-${
        phase === 'feedback' && feedback ? feedback.rep.result : phase
      }`}
      data-testid="clip-drill"
    >
      {phoneDropped && (
        <div className="banner warn" role="alert" data-testid="phone-dropped">
          Phone disconnected ({phoneStatus}) — reconnect to continue.
        </div>
      )}
      <header className="hud">
        <span>Clip mode</span>
        <span>Rep {reps.length + (phase === 'ended' ? 0 : 1)}</span>
        <button
          type="button"
          className="link"
          onClick={stop}
          aria-label="Stop clip drill"
        >
          Stop (Esc)
        </button>
      </header>

      <main className="stage clip-drill-stage">
        <video
          ref={videoRef}
          className="clip-drill-video"
          data-testid="clip-drill-video"
          playsInline
          muted
          onPlaying={() => markClipStarted(performance.now())}
        />

        {phase === 'precue' && (
          <div className="ready">
            <span className="ready-label">WATCH</span>
          </div>
        )}

        {phase === 'showing' && cue && (
          <CueStage
            cue={cue}
            distance={null}
            textOverlayEnabled={false}
            keyHint={commitKeyLabel}
          />
        )}

        {phase === 'feedback' && feedback && (
          <div className="feedback">
            <span className="feedback-label">
              {feedbackLabel(feedback.rep.result)}
            </span>
            {feedback.rep.reactionMs !== null && (
              <span className="feedback-sub">{feedback.rep.reactionMs} ms</span>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function feedbackLabel(result: RepResult): string {
  switch (result) {
    case 'correct_go':
      return 'GO ✓'
    case 'correct_no_go':
      return 'HOLD ✓'
    case 'late':
      return 'LATE'
    case 'false_start':
      return 'FALSE START'
    case 'hesitation':
      return 'HESITATION'
  }
}
