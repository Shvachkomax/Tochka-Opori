import React, { useEffect, useRef, useState } from 'react';
import { createVoiceRecording, isUsableVoiceBlob } from './lib/voiceRecording.js';
import { fetchWithClientToken } from './lib/clientToken.js';
import { speechText } from '../lib/voice/speech-text.js';
import './health-conversation.css';

const LABELS = { idle: 'Готовы поговорить?', checking: 'Проверяем микрофон…', listening: 'Слушаю вас…', transcribing: 'Распознаю речь…', thinking: 'Готовлю ответ…', loading: 'Подготавливаю голос…', speaking: 'Помощник говорит', paused: 'Разговор на паузе' };

export default function HealthConversation({ sessionId, accessToken, onSend, onClose, onSpecialist }) {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [devices, setDevices] = useState([]);
  const [mic, setMic] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [level, setLevel] = useState(0);
  const [micOk, setMicOk] = useState(false);
  const [heard, setHeard] = useState(false);
  const [tested, setTested] = useState(false);
  const [consent, setConsent] = useState(false);
  const [auto, setAuto] = useState(true);
  const [typed, setTyped] = useState('');
  const [lastUser, setLastUser] = useState('');
  const [lastAnswer, setLastAnswer] = useState('');
  const [blocked, setBlocked] = useState(false);
  const audio = useRef(null);
  const box = useRef(null);
  const run = useRef(0);
  const autoRef = useRef(auto);
  const live = useRef({});
  autoRef.current = auto;
  const busy = !['idle', 'paused'].includes(phase);
  const canRecord = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && window.isSecureContext;
  const canSelectOutput = typeof HTMLMediaElement.prototype.setSinkId === 'function';

  function releaseMic() {
    live.current.finish?.();
    live.current.stream?.getTracks().forEach(t => t.stop());
    live.current.stream = null;
    live.current.context?.close().catch(() => {});
    live.current.context = null;
    clearInterval(live.current.meter);
    clearTimeout(live.current.timer);
  }
  function pause() {
    run.current++;
    live.current.abort?.abort();
    releaseMic();
    if (audio.current) { audio.current.pause(); audio.current.onended = null; }
    live.current.endPlayback?.();
    setPhase('paused'); setLevel(0); setBlocked(false);
  }
  useEffect(() => {
    const previous = document.activeElement;
    const player = audio.current;
    box.current?.focus();
    const hidden = () => { if (document.hidden) pause(); };
    const changed = () => { pause(); setMicOk(false); setHeard(false); setError('Устройства изменились. Проверьте микрофон и звук ещё раз.'); };
    document.addEventListener('visibilitychange', hidden);
    navigator.mediaDevices?.addEventListener?.('devicechange', changed);
    return () => {
      run.current++; live.current.abort?.abort(); releaseMic();
      if (player) { player.pause(); player.onended = null; player.onerror = null; }
      live.current.endPlayback?.();
      if (live.current.url) URL.revokeObjectURL(live.current.url);
      document.removeEventListener('visibilitychange', hidden);
      navigator.mediaDevices?.removeEventListener?.('devicechange', changed);
      previous?.focus?.();
    };
  }, []);

  function showFailure(e) {
    setError(e?.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в настройках браузера. Можно продолжить текстом.' : e?.name === 'NotFoundError' ? 'Микрофон не найден. Подключите его или продолжите текстом.' : e?.message || 'Не удалось продолжить. Попробуйте ещё раз или используйте текст.');
    setPhase('paused');
  }

  async function capture(id, checking = false) {
    if (!canRecord) throw new Error('В этом браузере запись недоступна. Откройте сайт по HTTPS в Safari или Chrome либо используйте текст.');
    setPhase(checking ? 'checking' : 'listening');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: true, noiseSuppression: true }, video: false });
    if (id !== run.current) { stream.getTracks().forEach(t => t.stop()); return null; }
    live.current.stream = stream;
    navigator.mediaDevices.enumerateDevices().then(d => { if (id === run.current) setDevices(d); }).catch(() => {});
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context(); live.current.context = context;
    await context.resume();
    if (id !== run.current) return null;
    const analyser = context.createAnalyser(); analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const recording = createVoiceRecording(stream);
    let voiced = false, lastVoice = Date.now(), peak = 0;
    const start = Date.now();
    const finish = () => { if (recording.recorder.state !== 'inactive') recording.recorder.stop(); };
    live.current.finish = finish;
    recording.recorder.addEventListener('error', finish);
    stream.getAudioTracks().forEach(t => t.addEventListener('ended', finish, { once: true }));
    recording.recorder.start(250);
    setPhase(checking ? 'checking' : 'listening');
    live.current.meter = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      peak = Math.max(peak, rms); setLevel(Math.min(100, rms * 900));
      if (rms > 0.018) { voiced = true; lastVoice = Date.now(); }
      if (!checking && ((voiced && Date.now() - lastVoice > 1800 && Date.now() - start > 2000) || (!voiced && Date.now() - start > 12000))) finish();
    }, 100);
    live.current.timer = setTimeout(finish, checking ? 5000 : 45000);
    const blob = await recording.blobPromise;
    if (id !== run.current) return null;
    releaseMic(); live.current.finish = null; setLevel(0);
    if (!voiced || !isUsableVoiceBlob(blob)) throw new Error('Не удалось услышать речь. Проверьте выбранный микрофон и говорите немного ближе.');
    return { blob, peak };
  }
  async function checkMic() {
    pause(); const id = ++run.current; setError(''); setMicOk(false);
    try {
      const result = await capture(id, true);
      if (!result || id !== run.current) return;
      setMicOk(true); setPhase('idle');
    } catch (e) { if (id === run.current) { releaseMic(); showFailure(e); } }
  }
  async function request(url, options, id) {
    const controller = new AbortController(); live.current.abort = controller;
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const res = await fetchWithClientToken(url, 'body', url.includes('transcribe') ? 'transcribe' : 'analyze', { ...options, signal: controller.signal });
      if (id !== run.current) return null;
      if (!res.ok) {
        const data = typeof res.json === 'function' ? await res.json().catch(() => ({})) : res;
        throw new Error(data.error || 'Сервис временно недоступен. Попробуйте позже.');
      }
      return res;
    } finally { clearTimeout(timer); }
  }
  async function play(blob, id) {
    if (id !== run.current) return;
    if (live.current.url) URL.revokeObjectURL(live.current.url);
    live.current.url = URL.createObjectURL(blob);
    const player = audio.current;
    player.src = live.current.url;
    if (canSelectOutput) await player.setSinkId(speaker || '');
    if (id !== run.current) return;
    setPhase('speaking');
    await new Promise((resolve, reject) => {
      live.current.endPlayback = resolve;
      player.onended = () => { setBlocked(false); resolve(); };
      player.onerror = () => reject(new Error('Не удалось воспроизвести звук. Проверьте громкость и выбранное устройство.'));
      player.play().catch(() => { if (id === run.current) { setBlocked(true); setError('Браузер остановил автоматическое воспроизведение. Нажмите «Воспроизвести».'); } });
    });
  }
  async function speak(payload, id) {
    setPhase('loading');
    const res = await request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'healthSpeech', speech_action: payload.action, session_id: sessionId, access_token: accessToken }) }, id);
    if (!res) return;
    const blob = await res.blob();
    if (payload.action === 'test' && id === run.current) setTested(true);
    await play(blob, id);
  }
  async function testSpeaker() {
    pause(); const id = ++run.current; setError(''); setHeard(false); setTested(false);
    try { await speak({ action: 'test' }, id); if (id === run.current) setPhase('idle'); }
    catch (e) { if (id === run.current) showFailure(e); }
  }
  async function turn(id, initialText) {
    try {
      let text = initialText;
      if (!text) {
        const recording = await capture(id);
        if (!recording || id !== run.current) return;
        setPhase('transcribing');
        const res = await request('/api/transcribe', { method: 'POST', headers: { 'Content-Type': recording.blob.type, 'X-Module': 'body', 'X-Session-Id': sessionId, 'X-Access-Token': accessToken }, body: recording.blob }, id);
        if (!res) return;
        const data = await res.json(); text = data.text?.trim();
        if (!text) throw new Error('Речь не распознана. Повторите или введите сообщение.');
      }
      if (id !== run.current) return;
      if (text.length > 3000) throw new Error('Сообщение получилось слишком длинным. Разделите его на несколько частей.');
      setLastUser(text); setPhase('thinking');
      const message = await onSend(text);
      if (id !== run.current) return;
      if (!message) throw new Error('Не удалось получить ответ. Проверьте историю перед повторной отправкой.');
      const answer = speechText(message); setLastAnswer(answer);
      if (heard && message.speech_ticket) await speak({ action: 'speak', text: answer, ticket: message.speech_ticket }, id);
      else if (heard) setError('Озвучивание этого ответа недоступно. Ответ показан текстом.');
      if (id !== run.current) return;
      // Safety responses and text turns require an explicit next action.
      if (!initialText && autoRef.current && heard && message.speech_ticket && !message.safety_note && message.confidence !== 'low') return turn(id);
      setPhase('idle');
    } catch (e) { if (id === run.current) { releaseMic(); showFailure(e); } }
  }
  function start(text) { const id = ++run.current; setError(''); setTyped(''); turn(id, text); }
  function trap(e) {
    if (e.key === 'Escape') { pause(); onClose(); }
    if (e.key !== 'Tab') return;
    const nodes = [...box.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href]')].filter(node => node.getClientRects().length);
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  return <div className="health-talk-overlay"><section className="health-talk" role="dialog" aria-modal="true" aria-labelledby="health-talk-title" tabIndex={-1} ref={box} onKeyDown={trap}>
    <header><div><p className="health-talk-eyebrow">HEALTH · ГОЛОСОВОЙ ДИАЛОГ</p><h2 id="health-talk-title">Давайте поговорим</h2></div><button aria-label="Закрыть разговор" onClick={() => { pause(); onClose(); }}>✕</button></header>
    <p>Вы общаетесь с ИИ-помощником. Он не заменяет врача. Текст разговора сохраняется в вашей истории Health.</p>
    <label className="health-talk-check"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Разрешаю отправлять мои голосовые сообщения сервису распознавания. Не называю контактные данные.</label>
    <details open={!micOk || !heard}><summary>Микрофон и воспроизведение</summary><div className="health-talk-devices">
      <label>Микрофон<select value={mic} disabled={busy} onChange={e => { setMic(e.target.value); setMicOk(false); }}><option value="">По умолчанию</option>{devices.filter(d => d.kind === 'audioinput').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Микрофон'}</option>)}</select></label>
      <button disabled={busy || !canRecord} onClick={checkMic}>Проверить микрофон · 5 секунд</button>
      <div><meter min="0" max="100" value={level} aria-label="Уровень микрофона" /> <span>{micOk ? 'Сигнал микрофона получен' : 'Скажите несколько слов во время проверки'}</span></div>
      {canSelectOutput ? <label>Воспроизведение<select value={speaker} disabled={busy} onChange={e => { setSpeaker(e.target.value); setHeard(false); setTested(false); }}><option value="">По умолчанию</option>{devices.filter(d => d.kind === 'audiooutput').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Динамик / наушники'}</option>)}</select></label> : <p>Динамик или наушники выбираются в настройках устройства. Проверьте громкость, Bluetooth и беззвучный режим.</p>}
      <button disabled={busy} onClick={testSpeaker}>Прослушать пробный ответ</button>
      {tested && <div className="health-talk-actions"><button onClick={() => { setHeard(true); setError(''); }}>Да, слышу</button><button onClick={() => { pause(); setHeard(false); setError('Проверьте громкость и подключённые наушники. Затем повторите пробный ответ.'); }}>Не слышу</button></div>}
      {!canRecord && <p>Запись в этом браузере недоступна. Можно продолжить текстом.</p>}
    </div></details>
    <div className="health-talk-status" role="status"><span className={phase === 'listening' ? 'health-talk-orb listening' : 'health-talk-orb'}>🎙</span><strong>{LABELS[phase]}</strong>{phase === 'listening' && <small>Говорите. После паузы сообщение отправится. Максимум 45 секунд.</small>}</div>
    {error && <p role="alert" className="health-talk-error">{error}</p>}
    <audio ref={audio} playsInline preload="auto" />
    {blocked && <button onClick={() => { audio.current?.play().then(() => { setBlocked(false); setError(''); }).catch(() => setError('Воспроизведение недоступно. Продолжите текстом.')); }}>Воспроизвести</button>}
    <label className="health-talk-check"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />Слушать следующую реплику после ответа</label>
    <div className="health-talk-actions">
      <button className="primary" disabled={busy || !consent || !micOk || !heard} onClick={() => start()}>Начать разговор</button>
      <button disabled={!busy} onClick={pause}>Пауза / остановить ответ</button>
      {phase === 'listening' && <button onClick={() => live.current.finish?.()}>Я закончил</button>}
    </div>
    {(lastUser || lastAnswer) && <div className="health-talk-transcript">{lastUser && <p><b>Вы:</b> {lastUser}</p>}{lastAnswer && <p><b>Помощник:</b> {lastAnswer}</p>}</div>}
    <form onSubmit={e => { e.preventDefault(); if (typed.trim() && !busy) start(typed.trim()); }}><label htmlFor="health-talk-text">Можно написать вместо голоса</label><textarea id="health-talk-text" maxLength={3000} value={typed} onChange={e => setTyped(e.target.value)} disabled={busy} /><button disabled={busy || !typed.trim()}>Отправить текст</button></form>
    <footer><button onClick={() => { pause(); onClose(); onSpecialist?.(); }}>Связаться со специалистом</button><span>При непосредственной опасности — 112 или 103.</span></footer>
  </section></div>;
}
