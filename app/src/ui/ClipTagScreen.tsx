import { useEffect, useRef, useState } from 'react'
import { CUE_LIBRARY } from '../cues/library'
import { getClip, updateClipTag } from '../clipmode/library'
import { clampCueAtMs, stepFrame } from '../clipmode/tag'
import type { ClipRecord } from '../clipmode/types'
import type { CueId } from '../engine/types'

interface ClipTagScreenProps {
  clipId: string
  onClose: () => void
}

export function ClipTagScreen({ clipId, onClose }: ClipTagScreenProps) {
  // `clip` holds the immutable bits (id, blob, durationMs, name). User edits
  // live in `cueId` / `cueAtMs` and are pushed to Dexie on Save. We never
  // replace `clip` on save — otherwise its identity churn would re-fire the
  // blob-URL effect below and reset `<video>` mid-tag (code-reviewer B2).
  const [clip, setClip] = useState<ClipRecord | null>(null)
  const [cueId, setCueId] = useState<CueId>(CUE_LIBRARY[0].id)
  const [cueAtMs, setCueAtMs] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  // `onClose` is intentionally NOT in the load effect's deps: parents
  // typically pass a fresh arrow each render, which would otherwise refetch
  // the clip and silently overwrite unsaved edits (code-reviewer B3).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    void getClip(clipId).then((c) => {
      if (cancelled) return
      if (!c) {
        onCloseRef.current()
        return
      }
      setClip(c)
      if (c.cueId !== undefined) setCueId(c.cueId)
      if (c.cueAtMs !== undefined) setCueAtMs(c.cueAtMs)
    })
    return () => {
      cancelled = true
    }
  }, [clipId])

  useEffect(() => {
    if (!clip) return
    let url: string
    try {
      url = URL.createObjectURL(clip.blob)
    } catch {
      return
    }
    if (videoRef.current) videoRef.current.src = url
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [clip])

  function seekTo(ms: number) {
    if (!clip) return
    const clamped = clampCueAtMs(ms, clip.durationMs)
    setCueAtMs(clamped)
    const v = videoRef.current
    if (v) {
      try {
        v.currentTime = clamped / 1000
      } catch {
        /* video not ready */
      }
    }
  }

  function handleStep(delta: number) {
    if (!clip) return
    seekTo(stepFrame(cueAtMs, delta, clip.durationMs))
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    seekTo(Number(e.target.value))
  }

  function handleTimeUpdate() {
    const v = videoRef.current
    if (!v || !clip) return
    setCueAtMs(clampCueAtMs(v.currentTime * 1000, clip.durationMs))
  }

  async function handleSave() {
    if (!clip || saving) return
    setSaving(true)
    try {
      const updated = await updateClipTag(clip.id, { cueId, cueAtMs })
      if (updated) setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }

  if (!clip) {
    return (
      <div className="screen clip-tag" data-testid="clip-tag-loading">
        <p className="hint">Loading clip…</p>
      </div>
    )
  }

  return (
    <div className="screen clip-tag">
      <div className="clip-tag-header">
        <h1>Tag clip</h1>
        <button
          type="button"
          className="link"
          onClick={onClose}
          data-testid="clip-tag-close"
        >
          Close
        </button>
      </div>

      <p className="clip-tag-name">{clip.name}</p>

      <video
        ref={videoRef}
        controls
        preload="metadata"
        className="clip-tag-video"
        data-testid="clip-tag-video"
        onTimeUpdate={handleTimeUpdate}
      />

      <div className="clip-tag-scrub">
        <button
          type="button"
          onClick={() => handleStep(-1)}
          data-testid="clip-tag-frame-back"
        >
          −1 frame
        </button>
        <input
          type="range"
          min={0}
          max={clip.durationMs}
          step={1}
          value={cueAtMs}
          onChange={handleScrub}
          data-testid="clip-tag-scrub"
          aria-label="cue position in milliseconds"
        />
        <button
          type="button"
          onClick={() => handleStep(1)}
          data-testid="clip-tag-frame-forward"
        >
          +1 frame
        </button>
      </div>

      <p className="clip-tag-position" data-testid="clip-tag-position">
        Cue at {(cueAtMs / 1000).toFixed(2)} s of{' '}
        {(clip.durationMs / 1000).toFixed(2)} s
      </p>

      <label className="clip-tag-cue-select">
        Cue type
        <select
          value={cueId}
          onChange={(e) => setCueId(e.target.value as CueId)}
          data-testid="clip-tag-cue-select"
        >
          {CUE_LIBRARY.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <div className="clip-tag-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void handleSave()}
          disabled={saving}
          data-testid="clip-tag-save"
        >
          {saving ? 'Saving…' : 'Save tag'}
        </button>
        {savedAt !== null && (
          <span className="clip-tag-saved" data-testid="clip-tag-saved">
            Saved
          </span>
        )}
      </div>
    </div>
  )
}
