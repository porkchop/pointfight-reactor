import { useSession } from './store/session'
import { IdleScreen } from './ui/IdleScreen'
import { TrainerScreen } from './ui/TrainerScreen'
import { SummaryScreen } from './ui/SummaryScreen'
import './App.css'

function App() {
  const phase = useSession((s) => s.phase)

  if (phase === 'idle') return <IdleScreen />
  if (phase === 'ended') return <SummaryScreen />
  return <TrainerScreen />
}

export default App
