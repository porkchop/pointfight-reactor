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
import { AnalyticsScreen } from './ui/AnalyticsScreen'
import { PairScreen } from './ui/PairScreen'
import './App.css'

type IdleView = 'idle' | 'settings' | 'analytics' | 'pair'

function App() {
  const phase = useSession((s) => s.phase)
  const [view, setView] = useState<IdleView>('idle')
  const [settings, setSettings] = useState<SettingsRecord>(DEFAULT_SETTINGS)

  useEffect(() => {
    void loadSettings().then(setSettings)
  }, [view])

  if (view === 'settings') {
    return (
      <SettingsScreen
        onClose={() => setView('idle')}
        onOpenPair={() => setView('pair')}
      />
    )
  }
  if (view === 'analytics') {
    return <AnalyticsScreen onClose={() => setView('idle')} />
  }
  if (view === 'pair') {
    return <PairScreen onClose={() => setView('settings')} />
  }
  if (phase === 'idle')
    return (
      <IdleScreen
        onOpenSettings={() => setView('settings')}
        onOpenAnalytics={() => setView('analytics')}
      />
    )
  if (phase === 'ended') return <SummaryScreen />
  return (
    <TrainerScreen
      commitKeyCode={settings.commitKeyCode}
      commitKeyLabel={settings.commitKeyLabel}
    />
  )
}

export default App
