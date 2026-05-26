import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type SettingsRecord,
} from '../store/settings'
import { validateDrillConfig } from '../engine/drill'
import {
  DEFAULT_DRILL_CONFIG,
  PRE_CUE_MAX_CEILING_MS,
  PRE_CUE_MIN_FLOOR_MS,
  type DrillConfig,
  type InputSource,
} from '../engine/types'

interface SettingsScreenProps {
  onClose: () => void
}

export function SettingsScreen({ onClose }: SettingsScreenProps) {
  const [settings, setSettings] = useState<SettingsRecord>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [rebinding, setRebinding] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s)
      setLoaded(true)
    })
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

  function update<K extends keyof SettingsRecord>(
    key: K,
    value: SettingsRecord[K],
  ): void {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    const asConfig: DrillConfig = { ...DEFAULT_DRILL_CONFIG, ...settings }
    const errs = validateDrillConfig(asConfig)
    if (errs.length > 0) {
      setErrors(errs.map((e) => `${e.field}: ${e.message}`))
      return
    }
    setErrors([])
    void saveSettings(settings)
    onClose()
  }

  if (!loaded) {
    return (
      <div className="screen settings">
        <p>Loading settings…</p>
      </div>
    )
  }

  return (
    <div className="screen settings">
      <header className="settings-header">
        <h1>Settings</h1>
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
      </header>

      <section className="settings-section">
        <h2>Input</h2>
        <label>
          <span>Input source</span>
          <select
            value={settings.inputSource}
            onChange={(e) =>
              update('inputSource', e.target.value as InputSource)
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
            value={settings.rounds}
            onChange={(e) =>
              update('rounds', Math.max(1, Number(e.target.value) || 1))
            }
          />
        </label>
        <label>
          <span>Work duration (seconds)</span>
          <input
            type="number"
            min={1}
            max={600}
            value={Math.round(settings.workMs / 1000)}
            onChange={(e) =>
              update('workMs', Math.max(1, Number(e.target.value) || 1) * 1000)
            }
          />
        </label>
        <label>
          <span>Rest duration (seconds)</span>
          <input
            type="number"
            min={0}
            max={600}
            value={Math.round(settings.restMs / 1000)}
            onChange={(e) =>
              update('restMs', Math.max(0, Number(e.target.value) || 0) * 1000)
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
            value={settings.preCueMinMs}
            onChange={(e) =>
              update('preCueMinMs', Number(e.target.value) || 0)
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
            value={settings.preCueMaxMs}
            onChange={(e) =>
              update('preCueMaxMs', Number(e.target.value) || 0)
            }
          />
        </label>
        <p className="hint">
          Range {PRE_CUE_MIN_FLOOR_MS}–{PRE_CUE_MAX_CEILING_MS} ms.
        </p>
      </section>

      <section className="settings-section">
        <h2>Visuals</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.distanceAxisEnabled}
            onChange={(e) =>
              update('distanceAxisEnabled', e.target.checked)
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
            checked={settings.audioToneEnabled}
            onChange={(e) => update('audioToneEnabled', e.target.checked)}
          />
          <span>Audio tone tracks distance (low → high pitch)</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.textOverlayEnabled}
            onChange={(e) => update('textOverlayEnabled', e.target.checked)}
          />
          <span>Show text label overlay (learning mode)</span>
        </label>
      </section>

      <section className="settings-section">
        <h2>Penalty counter</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.penaltyCounterEnabled}
            onChange={(e) =>
              update('penaltyCounterEnabled', e.target.checked)
            }
          />
          <span>
            False starts and hesitations add reps to a during-rest clear-list
          </span>
        </label>
        {settings.penaltyCounterEnabled && (
          <>
            <label>
              <span>Reps per false start</span>
              <input
                type="number"
                min={0}
                max={20}
                value={settings.perFalseStartPenalty}
                onChange={(e) =>
                  update(
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
                value={settings.perHesitationPenalty}
                onChange={(e) =>
                  update(
                    'perHesitationPenalty',
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
              />
            </label>
          </>
        )}
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
        <button type="button" className="primary" onClick={handleSave}>
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
