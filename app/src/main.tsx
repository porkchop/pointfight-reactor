import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isPhoneRoute } from './phone/pair-url.ts'

// eslint-disable-next-line react-refresh/only-export-components
const PhoneApp = lazy(() =>
  import('./phone/PhoneApp.tsx').then((m) => ({ default: m.PhoneApp })),
)

// Phase 2b.5: the phone companion is selected by a hash role marker
// (`#role=phone`) or the legacy `/phone` path — see `isPhoneRoute`. The
// hash form lets pairing work from a static host under a base path
// (GitHub Pages), where `/phone` would 404 with no SPA fallback.
const phoneRoute =
  typeof window !== 'undefined' && isPhoneRoute(window.location)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {phoneRoute ? (
      <Suspense fallback={<div className="screen">Loading phone…</div>}>
        <PhoneApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
