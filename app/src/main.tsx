import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// eslint-disable-next-line react-refresh/only-export-components
const PhoneApp = lazy(() =>
  import('./phone/PhoneApp.tsx').then((m) => ({ default: m.PhoneApp })),
)

const isPhoneRoute =
  typeof window !== 'undefined' &&
  /^\/phone(\/|$)/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPhoneRoute ? (
      <Suspense fallback={<div className="screen">Loading phone…</div>}>
        <PhoneApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
