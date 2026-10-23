import React, { useEffect, useRef, useState } from 'react';
import { fetchWithClientToken } from './lib/clientToken.js';
import './health-conversation.css';

const labels = { idle: 'Готовы поговорить?', checking: 'Проверяю доступ…', connecting: 'Подключаю голос…', active: 'Слушаю вас — можно говорить и перебивать', closing: 'Завершаю соединение…', closed: 'Разговор завершён' };

export default function HealthLiveConversation({ sessionId, accessToken, onClose, onSpecialist }) {
  const [phase, setPhase] = useState('idle'), [consent, setConsent] = useState(false), [error, setError] = useState('');
  const [transcript, setTranscript] = useState({ user: '', assistant: '' });
  const [seconds, setSeconds] = useState(0), [confirmed, setConfirmed] = useState(false), [blocked, setBlocked] = useState(false);
  const [level, setLevel] = useState(0), [backendTokens, setBackendTokens] = useState(0);
  const audio = useRef(null), box = useRef(null), current = useRef(null), mounted = useRef(true);
  const busy = ['checking', 'connecting', 'active', 'closing'].includes(phase);

  async function request(live_action, extra = {}) {
    const response = await fetchWithClientToken('/api/session', 'body', 'analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'healthLive', live_action, session_id: sessionId, access_token: accessToken, ...extra }),
      signal: AbortSignal.timeout(40000),
    });
    if (!response.json) throw new Error(response.error || 'Не удалось подтвердить доступ.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось открыть разговор.');
    return data;
  }
  function cleanup(run, final = false) {
    if (!run || run.finished) return;
    run.finished = true;
    clearInterval(run.timer); clearTimeout(run.closeTimer); clearTimeout(run.startTimer);
    run.stream?.getTracks().forEach(t => t.stop()); run.channel?.close(); run.peer?.close();
    run.context?.close().catch(() => {});
    if (current.current === run) {
      if (audio.current) { audio.current.pause(); audio.current.srcObject = null; }
      if (mounted.current) { setPhase('closed'); setLevel(0); setConfirmed(final); }
    }
  }
  function end(reason = '') {
    const run = current.current;
    if (!run || run.finished || run.closing) return;
    run.closing = true;
    run.stream?.getTracks().forEach(t => { t.enabled = false; });
    if (audio.current) audio.current.pause();
    if (mounted.current) { setPhase('closing'); if (reason) setError(reason); }
    run.closeWhenReady = () => { if (run.ready && run.channel?.readyState === 'open') run.channel.send(JSON.stringify({ type: 'session.close' })); };
    run.closeWhenReady();
    run.closeTimer = setTimeout(() => {
      if (mounted.current) setError('Связь закрыта локально. Итоговое время от провайдера не подтверждено.');
      cleanup(run);
    }, 15000);
  }
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; box.current?.focus();
    const hidden = () => { if (document.hidden) end('Разговор остановлен при уходе со страницы.'); };
    const changed = () => end('Устройство звука изменилось. Начните новый разговор.');
    document.addEventListener('visibilitychange', hidden); navigator.mediaDevices?.addEventListener?.('devicechange', changed);
    return () => {
      mounted.current = false; end(); current.current?.stream?.getTracks().forEach(t => t.stop());
      document.body.style.overflow = overflow; document.removeEventListener('visibilitychange', hidden);
      navigator.mediaDevices?.removeEventListener?.('devicechange', changed); previous?.focus?.();
    };
  }, []);
  function observeAudio(run, stream) {
    const analyser = run.context.createAnalyser(); analyser.fftSize = 512;
    run.context.createMediaStreamSource(stream).connect(analyser);
    run.analysers.push({ analyser, samples: new Float32Array(analyser.fftSize) });
  }
  async function start() {
    if (current.current && !current.current.finished) return;
    const run = { started: Date.now(), lastActivity: Date.now(), analysers: [], pending: new Set(), completed: new Set() };
    current.current = run;
    setError(''); setConfirmed(false); setBlocked(false); setTranscript({ user: '', assistant: '' }); setSeconds(0); setBackendTokens(0); setPhase('connecting');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Нужен браузер с WebRTC и микрофоном по HTTPS.');
      const Context = window.AudioContext || window.webkitAudioContext;
      run.context = new Context(); await run.context.resume();
      run.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (run.finished || run.closing || !mounted.current) { run.stream.getTracks().forEach(t => t.stop()); cleanup(run); return; }
      observeAudio(run, run.stream);
      const peer = new RTCPeerConnection(); run.peer = peer;
      run.stream.getAudioTracks().forEach(track => peer.addTrack(track, run.stream));
      peer.ontrack = event => {
        if (run.finished || !audio.current) return;
        const stream = new MediaStream([event.track]); observeAudio(run, stream); audio.current.srcObject = stream;
        if (!run.closing) audio.current.play().catch(() => { if (mounted.current && !run.finished) setBlocked(true); });
      };
      peer.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(peer.connectionState) && !run.finished) end('Соединение прервалось. Можно начать разговор заново.'); };
      const channel = peer.createDataChannel('oai-events'); run.channel = channel;
      channel.onmessage = ({ data }) => {
        if (run.finished) return;
        let event; try { event = JSON.parse(data); } catch { return; }
        if (event.type === 'session.started') {
          run.ready = true; run.started = Date.now(); run.lastActivity = Date.now(); clearTimeout(run.startTimer);
          if (run.closing || !mounted.current) { run.closeWhenReady?.(); return; }
          setPhase('active');
        }
        if (['session.usage.updated', 'session.closed'].includes(event.type) && Number.isFinite(event.usage?.seconds) && mounted.current) setSeconds(event.usage.seconds);
        if (event.type === 'session.closed') { cleanup(run, true); return; }
        if (event.type === 'error') { end('Голосовой сервис сообщил об ошибке. Используйте обычный режим или попробуйте позже.'); return; }
        if (event.type === 'response.event') {
          const nested = event.event, id = nested?.response?.id;
          if (nested?.type === 'response.created') run.pending.add(id);
          if (['response.completed', 'response.failed', 'response.incomplete'].includes(nested?.type)) {
            run.pending.delete(id); run.lastActivity = Date.now();
            if (id && !run.completed.has(id)) { run.completed.add(id); if (mounted.current) setBackendTokens(n => n + (nested.response?.usage?.total_tokens || 0)); }
          }
        }
        if (['session.input_transcript.delta', 'session.output_transcript.delta'].includes(event.type) && typeof event.delta === 'string') {
          run.lastActivity = Date.now();
          const who = event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
          if (mounted.current) setTranscript(prev => ({ ...prev, [who]: (prev[who] + event.delta).slice(-24000) }));
        }
      };
      channel.onclose = () => { if (!run.finished) { if (mounted.current) setError('Соединение закрыто без подтверждения итогового времени.'); cleanup(run); } };
      run.startTimer = setTimeout(() => end('Не удалось установить голосовую связь за отведённое время.'), 45000);
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      if (peer.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
        const done = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', done); resolve(); } };
        const timer = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', done); reject(new Error('Не удалось подготовить соединение.')); }, 10000);
        peer.addEventListener('icegatheringstatechange', done); done();
      });
      if (run.finished || run.closing) { cleanup(run); return; }
      const result = await request('create', { sdp: peer.localDescription.sdp, consent: true });
      if (run.finished) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
      run.timer = setInterval(() => {
        if (run.finished || run.closing || !run.ready) return;
        let peak = 0;
        for (const { analyser, samples } of run.analysers) {
          analyser.getFloatTimeDomainData(samples);
          peak = Math.max(peak, Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length));
        }
        if (peak > 0.015) run.lastActivity = Date.now();
        if (mounted.current) setLevel(Math.min(100, peak * 1000));
        if (Date.now() - run.started >= result.max_seconds * 1000) end('Завершён пятиминутный тест. Можно начать следующий разговор.');
        else if (!run.pending.size && Date.now() - run.lastActivity >= result.idle_seconds * 1000) end('Минуту не было активности — соединение закрывается, чтобы не расходовать минуты.');
      }, 200);
    } catch (e) {
      if (mounted.current && !run.finished) setError(e.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в настройках браузера.' : e.message || 'Не удалось подключиться.');
      cleanup(run);
    }
  }
  async function check() {
    setPhase('checking'); setError('');
    try { const data = await request('check'); if (mounted.current) setError(data.note); }
    catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setPhase('idle'); }
  }
  const close = () => { end(); onClose(); };
  return <div className="health-talk-overlay"><section className="health-talk" ref={box} role="dialog" aria-modal="true" aria-labelledby="health-live-title" tabIndex={-1} onKeyDown={e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const list = [...box.current.querySelectorAll('button:not(:disabled),input:not(:disabled),audio[controls],summary')].filter(el => el.getClientRects().length);
      if (e.shiftKey && [list[0], box.current].includes(document.activeElement)) { e.preventDefault(); list.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === list.at(-1)) { e.preventDefault(); list[0]?.focus(); }
    }
  }}>
    <header><div><p className="health-talk-eyebrow">HEALTH · ТЕСТ GPT-LIVE</p><h2 id="health-live-title">Поговорим?</h2></div><button aria-label="Закрыть разговор" onClick={close}>✕</button></header>
    <p>ИИ-помощник слушает и отвечает голосом. Можно перебивать. Тест — до 5 минут.</p>
    <label className="health-talk-check"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Согласен передавать речь и контекст моего Health в OpenAI для этого разговора.</label>
    <div className="health-talk-status"><div className={`health-talk-orb ${phase === 'active' ? 'listening' : ''}`}>🎙</div><span role="status">{labels[phase]}</span><meter min="0" max="100" value={level} aria-label="Уровень звука" /></div>
    <button className="primary health-talk-main" disabled={phase === 'checking' || phase === 'closing' || (!busy && !consent)} onClick={() => busy ? end() : start()}>{['active', 'connecting'].includes(phase) ? 'Я закончил' : phase === 'closing' ? 'Завершаю…' : 'Говорите'}</button>
    <audio ref={audio} autoPlay playsInline controls={blocked} style={{ width: '100%', display: blocked ? 'block' : 'none' }} />
    {blocked && <p>Браузер приостановил звук. Нажмите ▶ на плеере.</p>}
    {error && <p className="health-talk-error" role="status">{error}</p>}
    <details><summary>Расшифровка и стоимость теста</summary>
      <p>Время по данным API: {Math.round(seconds)} сек. Голос: ≈ ${(seconds / 60 * 0.05).toFixed(3)}. {confirmed ? 'Итог подтверждён.' : 'Окончательный расход пока не подтверждён.'}</p>
      <p>Рассуждения оплачиваются отдельно. Получено токенов backend: {backendTokens}. Это не итоговый счёт.</p>
      <div className="health-talk-transcript"><strong>Вы:</strong><p>{transcript.user || 'Пока нет речи'}</p><strong>ИИ:</strong><p>{transcript.assistant || 'Пока нет ответа'}</p></div>
      <p>Расшифровка видна только в этом окне и не записывается в дневник. При закрытии она исчезнет. Текст не гарантирует, что вся реплика прозвучала.</p>
      <button disabled={busy} onClick={check}>Проверить доступ к GPT-Live</button>
    </details>
    <footer><span>ИИ не заменяет врача.</span><button onClick={() => { close(); onSpecialist?.(); }}>Связаться со специалистом</button></footer>
  </section></div>;
}
