import assert from 'node:assert/strict';
import { chromium } from 'playwright';
let server;
if (!process.env.TEST_BASE_URL) {
  process.env.VITE_HEALTH_VOICE_ENABLED = 'true';
  const { createServer } = await import('vite');
  server = await createServer({ server: { host: '127.0.0.1', port: 5175, strictPort: true } });
  await server.listen();
}
// Optional installed Chromium path for restricted CI environments.
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox','--disable-dev-shm-usage'] } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let chats = 0, transcriptions = 0, speaks = 0;
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
try {
  await page.addInitScript(() => {
    window.testTracks = [];
    window.blockAudioOnce = false;
    // Playback is mocked; do not ask the browser to decode the fixture bytes.
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return this.testSrc || ''; }, set(value) { this.testSrc = value; } });
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.rejectMicrophone) throw new DOMException('denied','NotAllowedError');
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(); const gain = context.createGain();
      gain.gain.value = .2; oscillator.connect(gain);
      const destination = context.createMediaStreamDestination(); gain.connect(destination); oscillator.start();
      setTimeout(() => { gain.gain.value = 0; }, 2800);
      const tracks = destination.stream.getTracks(); window.testTracks.push(...tracks);
      for (const track of tracks) { const stop = track.stop.bind(track); track.stop = () => { stop(); oscillator.stop(); context.close(); }; }
      return destination.stream;
    };
    HTMLMediaElement.prototype.play = function() {
      if (window.blockAudioOnce) { window.blockAudioOnce=false; return Promise.reject(new DOMException('blocked','NotAllowedError')); }
      this.testTimer = setTimeout(() => this.onended?.(), 150);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function() { clearTimeout(this.testTimer); };
    HTMLMediaElement.prototype.setSinkId = async function() {};
  });
  await page.route('**/api/**', async route => {
    const req = route.request();
    if(req.url().includes('/api/client-token')) return route.fulfill({json:{token:'fixture',expires_at:new Date(Date.now()+900000).toISOString()}});
    if(req.url().includes('/api/transcribe')) { transcriptions++; assert.ok(req.headers()['content-type'].startsWith('audio/')); assert.equal(req.headers()['x-session-id'],'health-test'); return route.fulfill({json:{text:'Завтра хочу обсудить свой режим.'}}); }
    if(req.url().includes('/api/health-speech')) { speaks++; return route.fulfill({contentType:'audio/mpeg',body:Buffer.from('mock-mp3')}); }
    const data=req.postDataJSON();
    if(data?.action==='sendBodyAiMessage') { chats++; return route.fulfill({json:{ok:true,message:{role:'assistant',answer:'Давайте обсудим ваш день. Что для вас важно завтра?',speech_ticket:'fixture-ticket',confidence:'high'}}}); }
    return route.fulfill({json:{ok:true,messages:[],insights:[],logs:[],summaries:[]}});
  });
  await page.route('**/__voice-test', route => route.fulfill({ contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
import '/src/style.css';import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const {default:HealthCabinet}=await import('/src/HealthCabinet.jsx');
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(HealthCabinet,{sessionId:'health-test',accessToken:'fixture-access',profile:{},history:[],onOpenServiceRequests:()=>{window.specialistOpened=true}}));</script></body></html>` }));
  await page.goto(base+'/__voice-test');
  await page.getByRole('button',{name:'🎙 Поговорить'}).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Начать разговор',exact:true}).isDisabled(),true);
  await page.evaluate(() => { window.rejectMicrophone=true; });
  await dialog.getByRole('button',{name:/Проверить микрофон/}).click();
  await dialog.getByRole('alert').filter({hasText:'Разрешите доступ'}).waitFor();
  await page.evaluate(() => { window.rejectMicrophone=false; });
  await dialog.getByRole('button',{name:/Проверить микрофон/}).click();
  await dialog.getByText('Сигнал микрофона получен').waitFor({timeout:10000});
  assert.equal(await page.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')),true);
  await page.evaluate(()=>{window.blockAudioOnce=true});
  await dialog.getByRole('button',{name:'Прослушать пробный ответ'}).click();
  await dialog.getByRole('button',{name:'Воспроизвести',exact:true}).click();
  await dialog.getByRole('button',{name:'Да, слышу'}).click();
  await dialog.getByLabel('Разрешаю отправлять', {exact:false}).check();
  await dialog.getByLabel('Слушать следующую').uncheck();
  await dialog.getByRole('button',{name:'Начать разговор',exact:true}).click();
  await dialog.getByText('Распознаю речь…').waitFor({timeout:10000}).catch(()=>{});
  await dialog.getByText('Давайте обсудим ваш день. Что для вас важно завтра?',{exact:false}).waitFor({timeout:10000});
  await dialog.getByRole('button',{name:'Начать разговор',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.health-talk-status strong')?.textContent==='Готовы поговорить?');
  assert.equal(chats,1); assert.equal(transcriptions,1); assert.equal(speaks,2);
  await dialog.getByLabel('Можно написать вместо голоса').fill('Хочу обсудить сон');
  await dialog.getByRole('button',{name:'Отправить текст',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.health-talk-status strong')?.textContent==='Готовы поговорить?');
  assert.equal(chats,2);
  // No horizontal overflow at a phone-sized viewport.
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await dialog.getByRole('button',{name:'Начать разговор',exact:true}).click();
  await page.waitForTimeout(350);
  await dialog.getByRole('button',{name:'Пауза / остановить ответ'}).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')),true);
  assert.equal(transcriptions,1);
  await page.screenshot({path:'/tmp/health-voice-mobile.png',fullPage:true});
  await dialog.getByRole('button',{name:'Связаться со специалистом'}).click();
  assert.equal(await page.evaluate(()=>window.specialistOpened),true);
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Health voice browser PASS: mic denial/recovery, meter, autoplay fallback, recording → transcript → existing chat → speech, text fallback, pause cleanup, specialist, mobile layout. Audio and APIs mocked.');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Page:', (await page.locator('body').innerText()).slice(0, 2000));
  throw error;
} finally { await browser.close(); await server?.close(); }
