import { useEffect, useState } from 'react'
import { listRecentSessions } from '../store/db'
import { useSession } from '../store/session'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  type SettingsRecord,
} from '../store/settings'
import type { SessionRecord } from '../engine/types'

interface IdleScreenProps {
  onOpenSettings: () => void
}

export function IdleScreen({ onOpenSettings }: IdleScreenProps) {
  const start = useSession((s) => s.start)
  const [recent, setRecent] = useState<SessionRecord[]>([])
  const [settings, setSettings] = useState<SettingsRecord>(DEFAULT_SETTINGS)

  useEffect(() => {
    void listRecentSessions(5).then(setRecent)
    void loadSettings().then(setSettings)
  }, [])

  function handleStart() {
    void requestFullscreen()
    start(
      {
        rounds: settings.rounds,
        workMs: settings.workMs,
        restMs: settings.restMs,
        preCueMinMs: settings.preCueMinMs,
        preCueMaxMs: settings.preCueMaxMs,
        penaltyCounterEnabled: settings.penaltyCounterEnabled,
        perFalseStartPenalty: settings.perFalseStartPenalty,
        perHesitationPenalty: settings.perHesitationPenalty,
        distanceAxisEnabled: settings.distanceAxisEnabled,
        audioToneEnabled: settings.audioToneEnabled,
        textOverlayEnabled: settings.textOverlayEnabled,
      },
      undefined,
      settings.inputSource,
    )
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

      <button
        className="primary"
        type="button"
        onClick={handleStart}
        autoFocus
      >
        Start drill
      </button>
      <p className="hint">
        Press <kbd>{settings.commitKeyLabel}</kbd> to commit. Press{' '}
        <kbd>Esc</kbd> to stop.
      </p>

      <button type="button" className="link" onClick={onOpenSettings}>
        Settings
      </button>

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
