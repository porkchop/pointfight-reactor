import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  loadActiveProfile,
  loadSettings,
  saveSettings,
  setActiveProfile,
  type SettingsRecord,
} from '../store/settings'
import {
  buildDefaultProfile,
  deleteProfile,
  listProfiles,
  saveProfile,
  type ProfileRecord,
} from '../store/profiles'
import { validateDrillConfig } from '../engine/drill'
import { buildTaperProfileBlueprint } from '../engine/analytics'
import { listRecentSessions, listRepsForSessions } from '../store/db'
import { CUE_LIBRARY } from '../cues/library'
import {
  DEFAULT_DRILL_CONFIG,
  PRE_CUE_MAX_CEILING_MS,
  PRE_CUE_MIN_FLOOR_MS,
  type CueId,
  type DrillConfig,
  type InputSource,
  type RepResult,
} from '../engine/types'

interface SettingsScreenProps {
  onClose: () => void
  onOpenPair?: () => void
}

const SCORE_FIELDS: { key: RepResult; label: string }[] = [
  { key: 'correct_go', label: 'Correct go' },
  { key: 'correct_no_go', label: 'Correct no-go' },
  { key: 'late', label: 'Late' },
  { key: 'hesitation', label: 'Hesitation' },
  { key: 'false_start', label: 'False start' },
]

export function SettingsScreen({ onClose, onOpenPair }: SettingsScreenProps) {
  const [settings, setSettings] = useState<SettingsRecord>(DEFAULT_SETTINGS)
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const [profiles, setProfiles] = useState<ProfileRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [rebinding, setRebinding] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [taperReason, setTaperReason] = useState<string | null>(null)
  const [taperError, setTaperError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadSettings(), loadActiveProfile(), listProfiles()]).then(
      ([s, p, all]) => {
        if (cancelled) return
        setSettings(s)
        setProfile(p)
        setProfiles(all)
        setLoaded(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!rebinding) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRebinding(false)
        return
      }
      e.preventDefault()
      setSettings((prev) => ({
        ...prev,
        commitKeyCode: e.code,
        commitKeyLabel: humanizeKeyCode(e.code, e.key),
      }))
      setRebinding(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rebinding])

  function updateSettings<K extends keyof SettingsRecord>(
    key: K,
    value: SettingsRecord[K],
  ): void {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  function updateConfig<K extends keyof DrillConfig>(
    key: K,
    value: DrillConfig[K],
  ): void {
    setProfile((prev) =>
      prev ? { ...prev, config: { ...prev.config, [key]: value } } : prev,
    )
  }

  function updateScoreWeight(result: RepResult, value: number): void {
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            config: {
              ...prev.config,
              scoreWeights: { ...prev.config.scoreWeights, [result]: value },
            },
          }
        : prev,
    )
  }

  function toggleAllowedCue(cueId: CueId): void {
    setProfile((prev) => {
      if (!prev) return prev
      const current = prev.config.allowedCueIds ?? CUE_LIBRARY.map((c) => c.id)
      const set = new Set(current)
      if (set.has(cueId)) set.delete(cueId)
      else set.add(cueId)
      const next =
        set.size === CUE_LIBRARY.length ? null : Array.from(set)
      return { ...prev, config: { ...prev.config, allowedCueIds: next } }
    })
  }

  async function handleSave() {
    if (!profile) return
    const errs = validateDrillConfig(profile.config)
    if (errs.length > 0) {
      setErrors(errs.map((e) => `${e.field}: ${e.message}`))
      return
    }
    setErrors([])
    await saveProfile(profile)
    await saveSettings(settings)
    onClose()
  }

  async function handleSwitchProfile(id: string) {
    if (!id || id === profile?.id) return
    await setActiveProfile(id)
    const next = profiles.find((p) => p.id === id)
    if (next) setProfile(next)
    setSettings((prev) => ({ ...prev, activeProfileId: id }))
  }

  async function handleCreateProfile() {
    const name = prompt('New profile name?', `Profile ${profiles.length + 1}`)
    if (!name) return
    const base = profile
      ? { ...profile.config }
      : { ...DEFAULT_DRILL_CONFIG }
    const fresh = { ...buildDefaultProfile(base), name }
    await saveProfile(fresh)
    await setActiveProfile(fresh.id)
    setProfile(fresh)
    setProfiles((prev) => [...prev, fresh])
    setSettings((prev) => ({ ...prev, activeProfileId: fresh.id }))
  }

  async function handleRenameProfile() {
    if (!profile) return
    const name = prompt('Rename profile to:', profile.name)
    if (!name) return
    const renamed = { ...profile, name }
    await saveProfile(renamed)
    setProfile(renamed)
    setProfiles((prev) => prev.map((p) => (p.id === renamed.id ? renamed : p)))
  }

  async function handleDeleteProfile() {
    if (!profile) return
    if (profiles.length <= 1) {
      setErrors(['Cannot delete the only remaining profile.'])
      return
    }
    if (!confirm(`Delete profile "${profile.name}"?`)) return
    const remaining = profiles.filter((p) => p.id !== profile.id)
    await deleteProfile(profile.id)
    await setActiveProfile(remaining[0].id)
    setProfile(remaining[0])
    setProfiles(remaining)
    setSettings((prev) => ({ ...prev, activeProfileId: remaining[0].id }))
  }

  async function handleBuildTaperProfile() {
    const sessions = await listRecentSessions(5)
    if (sessions.length === 0) {
      setTaperError('No sessions yet — run a drill first.')
      setTaperReason(null)
      return
    }
    const reps = await listRepsForSessions(sessions.map((s) => s.id))
    const blueprint = buildTaperProfileBlueprint(
      sessions,
      reps,
      profile?.config ?? DEFAULT_DRILL_CONFIG,
      3,
    )
    if (!blueprint) {
      setTaperError(
        'Not enough data to pick taper cues. Drill more variety first.',
      )
      setTaperReason(null)
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const fresh = {
      ...buildDefaultProfile(blueprint.config),
      name: `Taper — ${today}`,
    }
    await saveProfile(fresh)
    await setActiveProfile(fresh.id)
    setProfile(fresh)
    setProfiles((prev) => [...prev, fresh])
    setSettings((prev) => ({ ...prev, activeProfileId: fresh.id }))
    setTaperReason(blueprint.reason)
    setTaperError(null)
  }

  if (!loaded || !profile) {
    return (
      <div className="screen settings">
        <p>Loading settings…</p>
      </div>
    )
  }

  const config = profile.config
  const allowedCueIds = config.allowedCueIds ?? CUE_LIBRARY.map((c) => c.id)
  const allowedSet = new Set(allowedCueIds)

  return (
    <div className="screen settings">
      <header className="settings-header">
        <h1>Settings</h1>
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
      </header>

      <section className="settings-section">
        <h2>Profile</h2>
        <label>
          <span>Active profile</span>
          <select
            value={profile.id}
            onChange={(e) => void handleSwitchProfile(e.target.value)}
            aria-label="active profile"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="profile-actions">
          <button
            type="button"
            className="link"
            onClick={() => void handleCreateProfile()}
          >
            New profile
          </button>
          <button
            type="button"
            className="link"
            onClick={() => void handleRenameProfile()}
          >
            Rename
          </button>
          <button
            type="button"
            className="link"
            onClick={() => void handleDeleteProfile()}
          >
            Delete
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Input</h2>
        <label>
          <span>Input source</span>
          <select
            value={settings.inputSource}
            onChange={(e) =>
              updateSettings('inputSource', e.target.value as InputSource)
            }
          >
            <option value="keyboard">Keyboard (fallback / dev)</option>
            <option value="pedal">Foot pedal</option>
          </select>
        </label>
        <label>
          <span>Commit key</span>
          {rebinding ? (
            <span className="rebind-prompt">Press a key… (Esc to cancel)</span>
          ) : (
            <button
              type="button"
              className="rebind-button"
              onClick={() => setRebinding(true)}
              aria-label="Rebind commit key"
            >
              {settings.commitKeyLabel} ({settings.commitKeyCode})
            </button>
          )}
        </label>
        <p className="hint">
          USB foot pedals enumerate as keyboards. Configure your pedal to emit
          whichever key you bind here.
        </p>
      </section>

      <section className="settings-section">
        <h2>Rounds</h2>
        <label>
          <span>Round count</span>
          <input
            type="number"
            min={1}
            max={20}
            value={config.rounds}
            onChange={(e) =>
              updateConfig('rounds', Math.max(1, Number(e.target.value) || 1))
            }
          />
        </label>
        <label>
          <span>Work duration (seconds)</span>
          <input
            type="number"
            min={1}
            max={600}
            value={Math.round(config.workMs / 1000)}
            onChange={(e) =>
              updateConfig(
                'workMs',
                Math.max(1, Number(e.target.value) || 1) * 1000,
              )
            }
          />
        </label>
        <label>
          <span>Rest duration (seconds)</span>
          <input
            type="number"
            min={0}
            max={600}
            value={Math.round(config.restMs / 1000)}
            onChange={(e) =>
              updateConfig(
                'restMs',
                Math.max(0, Number(e.target.value) || 0) * 1000,
              )
            }
          />
        </label>
      </section>

      <section className="settings-section">
        <h2>Pre-cue delay</h2>
        <label>
          <span>Min (ms)</span>
          <input
            type="number"
            min={PRE_CUE_MIN_FLOOR_MS}
            max={PRE_CUE_MAX_CEILING_MS}
            step={100}
            value={config.preCueMinMs}
            onChange={(e) =>
              updateConfig('preCueMinMs', Number(e.target.value) || 0)
            }
          />
        </label>
        <label>
          <span>Max (ms)</span>
          <input
            type="number"
            min={PRE_CUE_MIN_FLOOR_MS}
            max={PRE_CUE_MAX_CEILING_MS}
            step={100}
            value={config.preCueMaxMs}
            onChange={(e) =>
              updateConfig('preCueMaxMs', Number(e.target.value) || 0)
            }
          />
        </label>
        <p className="hint">
          Range {PRE_CUE_MIN_FLOOR_MS}–{PRE_CUE_MAX_CEILING_MS} ms.
        </p>
      </section>

      <section className="settings-section">
        <h2>Choice-RT thresholds</h2>
        <label>
          <span>Hesitation threshold (ms)</span>
          <input
            type="number"
            min={100}
            max={2000}
            step={50}
            value={config.hesitationThresholdMs}
            onChange={(e) =>
              updateConfig(
                'hesitationThresholdMs',
                Number(e.target.value) || 0,
              )
            }
          />
        </label>
        <label>
          <span>Late threshold (ms)</span>
          <input
            type="number"
            min={100}
            max={3000}
            step={50}
            value={config.lateThresholdMs}
            onChange={(e) =>
              updateConfig('lateThresholdMs', Number(e.target.value) || 0)
            }
          />
        </label>
        <label>
          <span>Response window (ms)</span>
          <input
            type="number"
            min={100}
            max={5000}
            step={50}
            value={config.responseWindowMs}
            onChange={(e) =>
              updateConfig('responseWindowMs', Number(e.target.value) || 0)
            }
          />
        </label>
        <p className="hint">
          hesitation &lt; late &lt; response-window. Defaults 450 / 600 / 1200.
        </p>
      </section>

      <section className="settings-section">
        <h2>Cue subset</h2>
        <div className="cue-subset-grid">
          {CUE_LIBRARY.map((cue) => (
            <label key={cue.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={allowedSet.has(cue.id)}
                onChange={() => toggleAllowedCue(cue.id)}
              />
              <span>{cue.label}</span>
            </label>
          ))}
        </div>
        <p className="hint">
          Uncheck to remove a cue from this profile. Must keep at least one go
          cue.
        </p>
      </section>

      <section className="settings-section">
        <h2>Scoring weights</h2>
        <div className="score-grid">
          {SCORE_FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <input
                type="number"
                step={1}
                value={config.scoreWeights[f.key]}
                onChange={(e) =>
                  updateScoreWeight(f.key, Number(e.target.value) || 0)
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>Visuals</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.distanceAxisEnabled}
            onChange={(e) =>
              updateConfig('distanceAxisEnabled', e.target.checked)
            }
          />
          <span>
            Enable distance axis (far / mid / in-range changes correct
            response)
          </span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.audioToneEnabled}
            onChange={(e) => updateConfig('audioToneEnabled', e.target.checked)}
          />
          <span>Audio tone tracks distance (low → high pitch)</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.textOverlayEnabled}
            onChange={(e) =>
              updateConfig('textOverlayEnabled', e.target.checked)
            }
          />
          <span>Show text label overlay (learning mode)</span>
        </label>
      </section>

      <section className="settings-section">
        <h2>Penalty counter</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.penaltyCounterEnabled}
            onChange={(e) =>
              updateConfig('penaltyCounterEnabled', e.target.checked)
            }
          />
          <span>
            False starts and hesitations add reps to a during-rest clear-list
          </span>
        </label>
        {config.penaltyCounterEnabled && (
          <>
            <label>
              <span>Reps per false start</span>
              <input
                type="number"
                min={0}
                max={20}
                value={config.perFalseStartPenalty}
                onChange={(e) =>
                  updateConfig(
                    'perFalseStartPenalty',
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
              />
            </label>
            <label>
              <span>Reps per hesitation</span>
              <input
                type="number"
                min={0}
                max={20}
                value={config.perHesitationPenalty}
                onChange={(e) =>
                  updateConfig(
                    'perHesitationPenalty',
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
              />
            </label>
          </>
        )}
      </section>

      <section className="settings-section">
        <h2>Phone sensor (Phase 2b.1)</h2>
        <label>
          <span>Laptop LAN IP</span>
          <input
            type="text"
            value={settings.laptopLanIp ?? ''}
            placeholder="192.168.1.42"
            onChange={(e) =>
              updateSettings('laptopLanIp', e.target.value || undefined)
            }
            aria-label="laptop LAN IP"
          />
        </label>
        <p className="hint">
          Used to build the phone companion URL
          (<code>http://&lt;ip&gt;:5173/phone</code>). Manual pairing only in
          2b.1; QR-code pairing arrives in 2b.2.
        </p>
        {onOpenPair && (
          <div className="profile-actions">
            <button
              type="button"
              className="link"
              onClick={() => {
                // Persist settings (especially laptopLanIp) before the
                // PairScreen mounts and reads them from IDB.
                void saveSettings(settings).then(onOpenPair)
              }}
              aria-label="open pair phone"
            >
              Pair phone
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>Taper mode</h2>
        <p className="hint">
          Auto-build a low-volume profile (3 × 60s work / 30s rest) using only
          the cues you were slowest or least accurate on in the last 5
          sessions.
        </p>
        <div className="profile-actions">
          <button
            type="button"
            className="link"
            onClick={() => void handleBuildTaperProfile()}
          >
            Build taper profile
          </button>
        </div>
        {taperReason && (
          <div className="banner info" role="status">
            Taper profile created. {taperReason}
          </div>
        )}
        {taperError && <div className="banner warn">{taperError}</div>}
      </section>

      {errors.length > 0 && (
        <div className="banner warn">
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        <button type="button" className="primary" onClick={() => void handleSave()}>
          Save
        </button>
      </div>
    </div>
  )
}

function humanizeKeyCode(code: string, key: string): string {
  if (code === 'Space') return 'Space'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Enter') return 'Enter'
  return key.length === 1 ? key.toUpperCase() : code
}
