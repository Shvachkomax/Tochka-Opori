import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ClinicalKnowledge from './pages/specialist/ClinicalKnowledge.jsx'
import './style.css'

function showFatalError() {
  const root = document.getElementById('root')
  if (!root) return

  const panel = document.createElement('main')
  panel.style.cssText = 'min-height:100vh;box-sizing:border-box;padding:40px 20px;background:#F6F0E7;color:#2E2A25;font-family:Inter,system-ui,sans-serif;display:grid;place-items:center'
  const card = document.createElement('section')
  card.style.cssText = 'width:min(100%,520px);background:#fff;border:1px solid #E1D6C9;border-radius:20px;padding:28px;box-sizing:border-box;text-align:center'
  const title = document.createElement('h1')
  title.textContent = 'Не удалось открыть раздел'
  title.style.cssText = 'font-size:24px;margin:0 0 12px'
  const message = document.createElement('p')
  message.textContent = 'Обновите страницу. Если проблема повторится, обратитесь в поддержку.'
  message.style.cssText = 'font-size:14px;line-height:1.6;color:#625A50;margin:0 0 18px'
  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = 'Обновить страницу'
  reload.style.cssText = 'border:0;border-radius:12px;padding:11px 16px;background:#B85C4A;color:#fff;font-weight:700;cursor:pointer'
  reload.addEventListener('click', () => window.location.reload())

  card.append(title, message, reload)
  panel.append(card)
  root.replaceChildren(panel)
}

window.addEventListener('error', showFatalError)
window.addEventListener('unhandledrejection', showFatalError)

const pathname = window.location.pathname.replace(/\/+$/, '')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {pathname === '/specialist/knowledge' ? <ClinicalKnowledge /> : <App />}
  </React.StrictMode>,
)
