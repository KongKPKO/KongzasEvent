import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import AppUpdateNotice from './components/AppUpdateNotice.tsx'
import ReplayConsentControl from './components/ReplayConsentControl.tsx'
import './index.css'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { LanguageProvider } from './i18n.tsx'
import { initObservability } from './lib/observability.ts'

initObservability();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <App />
        <AppUpdateNotice />
        <ReplayConsentControl />
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
