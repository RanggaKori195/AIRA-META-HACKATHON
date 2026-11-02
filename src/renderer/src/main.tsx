import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
// Tampilan baru 29 Sep 2026 — WAJIB sesudah styles.css (menimpa aturan lama).
import './tampilan.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
