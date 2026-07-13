import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './style.css'

window.addEventListener('error', function (e) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML =
      '<div style="padding:40px;font-family:monospace;background:#050817;color:#fecaca;min-height:100vh">' +
      '<h2 style="color:#fca5a5;margin-bottom:16px">JavaScript ошибка</h2>' +
      '<div style="background:rgba(239,68,68,.1);padding:16px;border-radius:12;border:1px solid rgba(239,68,68,.3);margin-bottom:16px">' +
      '<strong style="color:#fca5a5">' + (e.error?.message || e.message || 'Неизвестная ошибка') + '</strong></div>' +
      '<pre style="font-size:12px;color:#94a3b8;white-space:pre-wrap;max-height:400px;overflow:auto;background:rgba(0,0,0,.3);padding:16px;border-radius:8px">' +
      (e.error?.stack || '') + '</pre></div>';
  }
});

window.addEventListener('unhandledrejection', function (e) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML =
      '<div style="padding:40px;font-family:monospace;background:#050817;color:#fecaca;min-height:100vh">' +
      '<h2 style="color:#fca5a5;margin-bottom:16px">Unhandled Promise Rejection</h2>' +
      '<div style="background:rgba(239,68,68,.1);padding:16px;border-radius:12;border:1px solid rgba(239,68,68,.3);margin-bottom:16px">' +
      '<strong style="color:#fca5a5">' + (e.reason?.message || e.reason || 'Неизвестная ошибка') + '</strong></div>' +
      '<pre style="font-size:12px;color:#94a3b8;white-space:pre-wrap;max-height:400px;overflow:auto;background:rgba(0,0,0,.3);padding:16px;border-radius:8px">' +
      (e.reason?.stack || '') + '</pre></div>';
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
