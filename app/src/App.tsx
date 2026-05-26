import { useEffect, useState } from 'react'
import { useSession } from './store/session'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  type SettingsRecord,
} from './store/settings'
import { IdleScreen } from './ui/IdleScreen'
import { TrainerScreen } from './ui/TrainerScreen'
import { SummaryScreen } from './ui/SummaryScreen'
import { SettingsScreen } from './ui/SettingsScreen'
import './App.css'

function App() {
  const phase = useSession((s) => s.phase)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<SettingsRecord>(DEFAULT_SETTINGS)

  useEffect(() => {
    void loadSettings().then(setSettings)
  }, [showSettings])

  if (showSettings) {
    return <SettingsScreen onClose={() => setShowSettings(false)} />
  }
  if (phase === 'idle')
    return <IdleScreen onOpenSettings={() => setShowSettings(true)} />
  if (phase === 'ended') return <SummaryScreen />
  return (
    <TrainerScreen
      commitKeyCode={settings.commitKeyCode}
      commitKeyLabel={settings.commitKeyLabel}
    />
  )
}

export default App
