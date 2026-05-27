import { useEffect, useState } from 'react'
import { listRecentSessions } from '../store/db'
import { useSession } from '../store/session'
import {
  DEFAULT_SETTINGS,
  loadActiveProfile,
  loadSettings,
  type SettingsRecord,
} from '../store/settings'
import type { ProfileRecord } from '../store/profiles'
import type { SessionRecord } from '../engine/types'
import { usePhonePeer } from '../store/phone-peer'
import { listClips } from '../clipmode/library'
import { selectTaggedClips, useClipRunner } from '../clipmode/runner'
import {
  CLIP_MODE_UNSUPPORTED_MESSAGE,
  isClipModeSupported,
} from '../clipmode/runtime'
import type { ClipRecord } from '../clipmode/types'

type DrillMode = 'live' | 'clip'

interface IdleScreenProps {
  onOpenSettings: () => void
  onOpenAnalytics: () => void
  /** Phase 2b.4 — present so the "Phone not paired — pair now" banner button has a destination. */
  onOpenPair?: () => void
  /** Phase 6.1 — navigates to ClipLibraryScreen for import / list / delete. */
  onOpenClips?: () => void
}

export function IdleScreen({
  onOpenSettings,
  onOpenAnalytics,
  onOpenPair,
  onOpenClips,
}: IdleScreenProps) {
  const start = useSession((s) => s.start)
  const startClip = useClipRunner((s) => s.start)
  const [recent, setRecent] = useState<SessionRecord[]>([])
  const [settings, setSettings] = useState<SettingsRecord>(DEFAULT_SETTINGS)
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const [mode, setMode] = useState<DrillMode>('live')
  const [clips, setClips] = useState<ClipRecord[]>([])
  const phoneStatus = usePhonePeer((s) => s.status)
  const [clipSupported] = useState<boolean>(() => isClipModeSupported())

  useEffect(() => {
    void listRecentSessions(5).then(setRecent)
    void loadSettings().then(setSettings)
    void loadActiveProfile().then(setProfile)
    void listClips().then(setClips)
  }, [])

  const phoneSelected = settings.inputSource === 'phone'
  const phoneReady = phoneStatus === 'connected'
  const taggedClips = selectTaggedClips(clips)
  const clipModeBlocked =
    mode === 'clip' && (!clipSupported || taggedClips.length === 0)
  const startDisabled =
    !profile || (phoneSelected && !phoneReady) || clipModeBlocked

  function handleStart() {
    if (startDisabled) return
    void requestFullscreen()
    if (!profile) return
    if (mode === 'clip') {
      startClip(clips, profile.config, undefined, settings.inputSource)
      return
    }
    start(profile.config, undefined, settings.inputSource)
  }

  return (
    <div className="screen idle">
      <h1>PointFight Reactor</h1>
      <p className="subtitle">First-beat go / no-go drill</p>

      {settings.inputSource === 'keyboard' && (
        <div className="banner info">
          Keyboard mode — foot pedal recommended for live drilling.
        </div>
      )}

      {phoneSelected && !phoneReady && (
        <div
          className="banner warn"
          role="status"
          data-testid="phone-not-paired"
        >
          Phone not paired —{' '}
          {onOpenPair ? (
            <button
              type="button"
              className="link"
              onClick={onOpenPair}
              aria-label="pair phone now"
            >
              pair now
            </button>
          ) : (
            <span>open Settings → Pair phone</span>
          )}
          .
        </div>
      )}

      {mode === 'clip' && !clipSupported && (
        <div
          className="banner warn"
          role="status"
          data-testid="clip-mode-unsupported"
        >
          {CLIP_MODE_UNSUPPORTED_MESSAGE}
        </div>
      )}
      {mode === 'clip' && clipSupported && taggedClips.length === 0 && (
        <div
          className="banner warn"
          role="status"
          data-testid="clip-mode-no-clips"
        >
          No tagged clips yet —{' '}
          {onOpenClips ? (
            <button
              type="button"
              className="link"
              onClick={onOpenClips}
              aria-label="open clip library"
            >
              open clip library
            </button>
          ) : (
            <span>open Manage clips to import + tag</span>
          )}
          .
        </div>
      )}

      {profile && (
        <p className="active-profile">
          Profile: <strong>{profile.name}</strong>
        </p>
      )}

      <fieldset
        className="mode-segmented"
        data-testid="mode-segmented"
        aria-label="drill mode"
      >
        <legend className="visually-hidden">Drill mode</legend>
        <label data-testid="mode-live">
          <input
            type="radio"
            name="drill-mode"
            value="live"
            checked={mode === 'live'}
            onChange={() => setMode('live')}
          />
          Live
        </label>
        <label data-testid="mode-clip">
          <input
            type="radio"
            name="drill-mode"
            value="clip"
            checked={mode === 'clip'}
            onChange={() => setMode('clip')}
          />
          Clip
        </label>
      </fieldset>

      <button
        className="primary"
        type="button"
        onClick={handleStart}
        disabled={startDisabled}
        autoFocus
      >
        Start drill
      </button>
      <p className="hint">
        Press <kbd>{settings.commitKeyLabel}</kbd> to commit. Press{' '}
        <kbd>Esc</kbd> to stop.
      </p>

      <div className="idle-links">
        <button type="button" className="link" onClick={onOpenSettings}>
          Settings
        </button>
        <button type="button" className="link" onClick={onOpenAnalytics}>
          Analytics
        </button>
        {onOpenClips && (
          <button
            type="button"
            className="link"
            onClick={onOpenClips}
            data-testid="manage-clips-link"
          >
            Manage clips
          </button>
        )}
      </div>

      {recent.length > 0 && (
        <div className="recent">
          <h2>Recent sessions</h2>
          <ul>
            {recent.map((s) => (
              <li key={s.id}>
                <span className="when">
                  {new Date(s.startedAt).toLocaleString()}
                </span>
                <span className="meta">
                  {s.repCount} reps · score {s.summary.score}
                  {s.summary.avgReactionMs !== null &&
                    ` · ${s.summary.avgReactionMs}ms avg`}
                  {s.inputSource && ` · ${s.inputSource}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

async function requestFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) return
    await document.documentElement.requestFullscreen()
  } catch {
    /* user can run windowed; no-op */
  }
}
