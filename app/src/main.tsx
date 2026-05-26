import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PhoneApp } from './phone/PhoneApp.tsx'

const isPhoneRoute =
  typeof window !== 'undefined' &&
  /^\/phone(\/|$)/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPhoneRoute ? <PhoneApp /> : <App />}
  </StrictMode>,
)
