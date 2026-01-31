import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
// LogRocket loaded via CDN in index.html for performance
if ((window as any).LogRocket) {
  (window as any).LogRocket.init('zrljr5/event-queue');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
