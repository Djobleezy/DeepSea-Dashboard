import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme/global.css'

// Register service worker for PWA / offline caching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((err) => console.warn('[SW] Registration failed:', err))
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
