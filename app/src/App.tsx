import { Suspense, lazy, useEffect, useState } from 'react'
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
import './App.css'

const PairScreen = lazy(() =>
  import('./ui/PairScreen').then((m) => ({ default: m.PairScreen })),
)

const ClipLibraryScreen = lazy(() =>
  import('./ui/ClipLibraryScreen').then((m) => ({
    default: m.ClipLibraryScreen,
  })),
)

const ClipTagScreen = lazy(() =>
  import('./ui/ClipTagScreen').then((m) => ({ default: m.ClipTagScreen })),
)

type IdleView = 'idle' | 'settings' | 'analytics' | 'pair' | 'clips' | 'tag'

function App() {
  const phase = useSession((s) => s.phase)
  const [view, setView] = useState<IdleView>('idle')
  // Remember which view sent the user to pair so closing returns there.
  const [pairOpener, setPairOpener] = useState<'idle' | 'settings'>('settings')
  const [taggingClipId, setTaggingClipId] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsRecord>(DEFAULT_SETTINGS)

  useEffect(() => {
    void loadSettings().then(setSettings)
  }, [view])

  if (view === 'settings') {
    return (
      <SettingsScreen
        onClose={() => setView('idle')}
        onOpenPair={() => {
          setPairOpener('settings')
          setView('pair')
        }}
      />
    )
  }
  if (view === 'analytics') {
    return <AnalyticsScreen onClose={() => setView('idle')} />
  }
  if (view === 'clips') {
    return (
      <Suspense fallback={<div className="screen">Loading clip library…</div>}>
        <ClipLibraryScreen
          onClose={() => setView('idle')}
          onTagClip={(clipId) => {
            setTaggingClipId(clipId)
            setView('tag')
          }}
        />
      </Suspense>
    )
  }
  if (view === 'tag' && taggingClipId) {
    return (
      <Suspense fallback={<div className="screen">Loading tag editor…</div>}>
        <ClipTagScreen
          clipId={taggingClipId}
          onClose={() => {
            setTaggingClipId(null)
            setView('clips')
          }}
        />
      </Suspense>
    )
  }
  if (view === 'pair') {
    return (
      <Suspense fallback={<div className="screen">Loading pair UI…</div>}>
        <PairScreen onClose={() => setView(pairOpener)} />
      </Suspense>
    )
  }
  if (phase === 'idle')
    return (
      <IdleScreen
        onOpenSettings={() => setView('settings')}
        onOpenAnalytics={() => setView('analytics')}
        onOpenPair={() => {
          setPairOpener('idle')
          setView('pair')
        }}
        onOpenClips={() => setView('clips')}
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
