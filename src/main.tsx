import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { LanguageProvider } from './i18n.tsx'

const logRocketAppId = import.meta.env.VITE_LOGROCKET_APP_ID;
if (logRocketAppId) {
  const script = document.createElement('script');
  script.src = 'https://cdn.logr-in.com/logger-1.min.js';
  script.async = true;
  script.onload = () => {
    (window as any).LogRocket?.init(logRocketAppId);
  };
  document.head.appendChild(script);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
