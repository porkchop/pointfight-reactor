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
  const [recent, setRecent] = useState<SessionRecord[]>([])
  const [settings, setSettings] = useState<SettingsRecord>(DEFAULT_SETTINGS)
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const phoneStatus = usePhonePeer((s) => s.status)

  useEffect(() => {
    void listRecentSessions(5).then(setRecent)
    void loadSettings().then(setSettings)
    void loadActiveProfile().then(setProfile)
  }, [])

  const phoneSelected = settings.inputSource === 'phone'
  const phoneReady = phoneStatus === 'connected'
  const startDisabled = !profile || (phoneSelected && !phoneReady)

  function handleStart() {
    if (startDisabled) return
    void requestFullscreen()
    if (!profile) return
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

      {profile && (
        <p className="active-profile">
          Profile: <strong>{profile.name}</strong>
        </p>
      )}

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
