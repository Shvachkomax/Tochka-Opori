import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
process.env.VITE_HEALTH_LIVE_ENABLED = 'true';
const server = await createServer({ server: { host: '127.0.0.1', port: 5176, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
let maxSeconds = 300, idleSeconds = 60, fail = false, creates = 0;
try {
  await page.addInitScript(() => {
    window.tracks = []; window.commands = []; window.peers = [];
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.denyMic) throw new DOMException('denied', 'NotAllowedError');
      const context = new AudioContext(); await context.resume();
      const destination = context.createMediaStreamDestination();
      for (const track of destination.stream.getTracks()) {
        window.tracks.push(track); const stop = track.stop.bind(track);
        track.stop = () => { stop(); context.close().catch(() => {}); };
      }
      return destination.stream;
    };
    HTMLMediaElement.prototype.play = function () { return window.blockAudio ? Promise.reject(new Error('autoplay blocked')) : Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () {};
    window.RTCPeerConnection = class {
      constructor() { window.peers.push(this); this.iceGatheringState = 'complete'; }
      addTrack(track) { this.track = track; }
      createDataChannel() {
        this.channel = { readyState: 'open', send: data => {
          const event = JSON.parse(data); window.commands.push(event);
          if (event.type === 'session.close' && !window.noFinal) setTimeout(() => this.emit({ type: 'session.closed', usage: { seconds: 18 } }), 10);
        }, close() { this.readyState = 'closed'; this.onclose?.(); } };
        return this.channel;
      }
      emit(event) { this.channel.onmessage?.({ data: JSON.stringify(event) }); }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nfixture' }; }
      async setLocalDescription(value) { this.localDescription = value; }
      async setRemoteDescription() {
        this.emit({ type: 'session.started', session: { id: 'live_test' } });
        this.ontrack?.({ track: this.track.clone() });
        this.emit({ type: 'session.input_transcript.delta', delta: 'Расскажу про сон.' });
        this.emit({ type: 'session.output_transcript.delta', delta: 'Давайте обсудим ваш режим.' });
        this.emit({ type: 'session.usage.updated', usage: { seconds: 12 } });
      }
      close() { this.closed = true; }
    };
  });
  await page.route('**/api/**', async route => {
    if (route.request().url().includes('/api/client-token')) return route.fulfill({ json: { token: 'fixture', expires_at: new Date(Date.now() + 900000).toISOString() } });
    const body = route.request().postDataJSON();
    if (body.action === 'healthLive') {
      if (body.live_action === 'check') return route.fulfill({ json: { note: 'Модель видна проекту' } });
      creates++; assert.equal(body.consent, true); assert.equal(body.session_id, 'health-test');
      return route.fulfill(fail ? { status: 502, json: { error: 'Тестовый сбой API' } } : { status: 201, json: { session: { id: 'live_test' }, transport: { sdp: 'answer' }, max_seconds: maxSeconds, idle_seconds: idleSeconds } });
    }
    return route.fulfill({ json: { ok: true, messages: [], insights: [], logs: [], summaries: [] } });
  });
  await page.route('**/__live-test', route => route.fulfill({ contentType: 'text/html', body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
import '/src/style.css';import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const {default:HealthCabinet}=await import('/src/HealthCabinet.jsx');
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(HealthCabinet,{sessionId:'health-test',accessToken:'fixture',profile:{},history:[]}));</script></body></html>` }));
  await page.goto('http://127.0.0.1:5176/__live-test');
  await page.getByRole('button', { name: 'Попробовать GPT-Live' }).click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByRole('button', { name: 'Говорите', exact: true }).isDisabled(), true);
  await dialog.getByRole('checkbox').check();
  await page.evaluate(() => { window.denyMic = true; });
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  await dialog.getByText('Разрешите доступ к микрофону', { exact: false }).waitFor();
  assert.equal(creates, 0);
  await page.evaluate(() => { window.denyMic = false; window.blockAudio = true; });
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  await dialog.getByText('Слушаю вас — можно говорить и перебивать').waitFor();
  await dialog.locator('audio[controls]').waitFor();
  await dialog.locator('summary').click();
  await dialog.getByLabel('Текст ответа ИИ').waitFor();
  await page.evaluate(() => {
    const peer = window.peers.at(-1);
    const event = { type: 'response.event', event: { type: 'response.completed', response: { id: 'resp_1', usage: { total_tokens: 30 } } } };
    peer.emit(event); peer.emit(event);
  });
  await dialog.getByText('Получено токенов backend: 30', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: 'Я закончил', exact: true }).click();
  await dialog.getByText('Микрофон на паузе — слушаем ответ').waitFor();
  assert.equal(await page.evaluate(() => window.commands.some(e => e.type === 'session.close')), false);
  assert.equal(await page.evaluate(() => window.peers.at(-1).track.enabled), false);
  await page.evaluate(() => window.peers.at(-1).emit({ type: 'session.output_transcript.delta', delta: ' Ответ после вашей реплики.' }));
  await dialog.getByLabel('Текст ответа ИИ').filter({ hasText: 'Ответ после вашей реплики.' }).waitFor();
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  assert.equal(await page.evaluate(() => window.peers.at(-1).track.enabled), true);
  assert.equal(creates, 1);
  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
  assert.equal(await dialog.getByRole('button', { name: 'Я закончил', exact: true }).count(), 1);
  await dialog.getByRole('button', { name: 'Завершить разговор', exact: true }).click();
  await dialog.getByText('Итог подтверждён.', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.tracks.every(t => t.readyState === 'ended')), true);
  assert.equal(await page.evaluate(() => window.peers.every(p => p.closed)), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // Start failure must release the microphone and allow retry.
  fail = true;
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  await dialog.getByText('Тестовый сбой API').waitFor();
  assert.equal(await page.evaluate(() => window.tracks.every(t => t.readyState === 'ended')), true);
  fail = false; idleSeconds = 0.4;
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  await dialog.getByText('Минуту не было активности', { exact: false }).waitFor();
  await dialog.getByText('Итог подтверждён.', { exact: false }).waitFor();
  idleSeconds = 60; maxSeconds = 0.4;
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  await dialog.getByText('Завершён пятиминутный тест', { exact: false }).waitFor();
  await dialog.getByText('Итог подтверждён.', { exact: false }).waitFor();
  maxSeconds = 300;
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  await dialog.getByText('Слушаю вас — можно говорить и перебивать').waitFor();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await dialog.getByText('Итог подтверждён.', { exact: false }).waitFor();
  await page.evaluate(() => { delete document.hidden; window.noFinal = true; });
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  await dialog.getByText('Слушаю вас — можно говорить и перебивать').waitFor();
  await page.evaluate(() => window.peers.at(-1).channel.close());
  await dialog.getByText('Соединение закрыто без подтверждения', { exact: false }).waitFor();
  assert.equal(await dialog.getByText('Итог подтверждён.', { exact: false }).count(), 0);
  await page.evaluate(() => { window.noFinal = false; });
  await dialog.getByRole('button', { name: 'Говорите', exact: true }).click();
  await dialog.getByText('Слушаю вас — можно говорить и перебивать').waitFor();
  await dialog.getByRole('button', { name: 'Закрыть разговор' }).click();
  await page.waitForFunction(() => window.peers.every(p => p.closed));
  assert.equal(await page.evaluate(() => window.tracks.every(t => t.readyState === 'ended')), true);
  assert.deepEqual(errors, []);
  console.log('Health Live browser PASS: consent, microphone denial/recovery, API failure, WebRTC startup, captions, autoplay fallback, duplicate usage, idle/duration close, unmount cleanup, mobile layout. API/media mocked.');
} finally { await browser.close(); await server.close(); }
