import React, { useEffect, useRef, useState } from 'react';
import { fetchWithClientToken } from './lib/clientToken.js';
import './health-conversation.css';

export default function HealthLiveConversation({sessionId,accessToken,onClose,onSpecialist,module='body'}) {
 const [phase,setPhase]=useState('idle'),[consent,setConsent]=useState(false),[error,setError]=useState('');
 const [code,setCode]=useState(''),[codeNote,setCodeNote]=useState(''),[paused,setPaused]=useState(false);
 const [transcript,setTranscript]=useState(''),[cost,setCost]=useState(null),[reserved,setReserved]=useState(null);
 const run=useRef(null),mounted=useRef(true),box=useRef(null);
 const busy=['connecting','active','closing','redeeming'].includes(phase);
 async function request(live_action,extra={}) {
  const response=await fetchWithClientToken('/api/session',module,'analyze',{
   method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),
   body:JSON.stringify({action:module==='support'?'supportLive':'healthLive',live_action,session_id:sessionId,access_token:accessToken,...extra})});
  if(!response.json)throw new Error(response.error||'Не удалось подтвердить доступ.');
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Разговор недоступен.');return data;
 }
 function dispose(r){
  if(!r||r.disposed)return;r.disposed=true;clearTimeout(r.timer);clearTimeout(r.connectTimer);
  r.stream?.getTracks().forEach(t=>t.stop());r.node?.disconnect();r.source?.disconnect();void r.context?.close().catch(()=>{});
  if(r.socket?.readyState===1||r.socket?.readyState===0)r.socket.close();
  if(r.ticket&&!r.started)void request('cancel',{ticket:r.ticket}).catch(()=>{});
  if(mounted.current)setPhase('closed');
 }
 function end(){
  const r=run.current;if(!r||r.disposed||r.closing)return;r.closing=true;
  r.stream?.getTracks().forEach(t=>{t.enabled=false;});r.node?.port.postMessage({type:'clear'});
  if(mounted.current)setPhase('closing');
  if(r.socket?.readyState===1)r.socket.send(JSON.stringify({type:'session.close'}));
  r.timer=setTimeout(()=>dispose(r),22000);
 }
 useEffect(()=>{
  mounted.current=true;const previous=document.activeElement,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';box.current?.focus();
  const hidden=()=>{if(document.hidden)end();};document.addEventListener('visibilitychange',hidden);
  return()=>{mounted.current=false;end();dispose(run.current);document.removeEventListener('visibilitychange',hidden);document.body.style.overflow=overflow;previous?.focus?.();};
 },[]);
 async function redeem(){
  setPhase('redeeming');setError('');
  try{await request('redeem',{test_code:code.trim()});if(mounted.current){setCode('');setCodeNote('Тестовый доступ активирован. Лимит общий для Support и Health.');}}
  catch(e){if(mounted.current)setError(e.message);}
  finally{if(mounted.current)setPhase('idle');}
 }
 async function start(){
  if(run.current&&!run.current.disposed)return;
  const r={};run.current=r;setPhase('connecting');setError('');setTranscript('');setCost(null);setPaused(false);
  try{
   if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Нужны HTTPS и доступ к микрофону.');
   r.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   if(r.disposed||r.closing||!mounted.current){r.stream.getTracks().forEach(t=>t.stop());dispose(r);return;}
   const Context=window.AudioContext||window.webkitAudioContext;
   r.context=new Context({sampleRate:24000});await r.context.resume();
   if(r.context.sampleRate!==24000)throw new Error('Этот браузер пока не поддерживает звук тестового режима. Попробуйте другой браузер.');
   await r.context.audioWorklet.addModule('/audio/live-pcm.js');
   if(r.disposed||r.closing||!mounted.current){dispose(r);return;}
   r.node=new AudioWorkletNode(r.context,'live-pcm',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
   r.source=r.context.createMediaStreamSource(r.stream);r.source.connect(r.node);r.node.connect(r.context.destination);
   r.node.port.onmessage=({data})=>{
    if(data.error){setError('Не удалось воспроизвести звук вовремя. Разговор завершается.');end();return;}
    if(data.pcm&&r.started&&!r.closing&&r.socket?.readyState===1){
     if(r.socket.bufferedAmount>96000){end();return;}r.socket.send(data.pcm);
    }
   };
   const result=await request('create',{consent:true,transport:'server_ws'});r.ticket=result.ticket;
   if(r.disposed||r.closing||!mounted.current){dispose(r);void request('cancel',{ticket:r.ticket}).catch(()=>{});return;}
   setReserved(result.reserved_credits);
   const url=new URL(result.socket_path,location.origin);url.protocol=location.protocol==='https:'?'wss:':'ws:';
   // Credentials travel in the first frame, never in URLs/access logs.
   r.socket=new WebSocket(url);r.socket.binaryType='arraybuffer';
   r.connectTimer=setTimeout(()=>{if(mounted.current)setError('Подключение не удалось. Резерв будет проверен перед следующим запуском.');end();},20000);
   r.socket.onopen=()=>{if(r.closing||r.disposed){dispose(r);return;}r.socket.send(JSON.stringify({ticket:r.ticket}));};
   r.socket.onmessage=({data})=>{
    if(r.disposed)return;
    if(data instanceof ArrayBuffer){if(!r.closing)r.node.port.postMessage({pcm:data},[data]);return;}
    let event;try{event=JSON.parse(data);}catch{return;}
    if(event.type==='session.started'){r.started=true;clearTimeout(r.connectTimer);if(mounted.current)setPhase('active');}
    if(event.type==='session.output_transcript.delta'&&mounted.current)setTranscript(p=>(p+event.delta).slice(-16000));
    if(event.type==='budget.usage'&&mounted.current)setCost(event.backend_microusd+event.voice_microusd);
    if(event.type==='budget.stopping'){
     if(mounted.current)setError(event.reason==='budget_exhausted'?'Остатка бюджета недостаточно для следующего ответа. Разговор завершается.':'Разговор завершается.');
     end();
    }
    if(event.type==='budget.closed'){
     if(mounted.current){setCost(event.charged_microusd);setError(event.confirmed?'':'Расход не подтверждён. Резерв сохранён, новый запуск требует проверки.');}
     dispose(r);
    }
    if(event.type==='budget.error'){if(mounted.current)setError(event.message);dispose(r);}
   };
   r.socket.onerror=()=>{if(mounted.current)setError('Голосовое соединение прервалось. Неподтверждённый резерв не пополняется автоматически.');end();};
   r.socket.onclose=()=>dispose(r);
   r.stream.getTracks().forEach(t=>t.addEventListener('ended',()=>end()));
  }catch(e){if(mounted.current)setError(e.name==='NotAllowedError'?'Разрешите доступ к микрофону.':e.message);dispose(r);}
 }
 function toggle(){const r=run.current;if(!r?.started||r.closing)return;const value=!paused;setPaused(value);r.node.port.postMessage({type:'pause',value});r.stream.getTracks().forEach(t=>{t.enabled=!value;});}
 const close=()=>{end();onClose();};
 const label={idle:'Готовы поговорить?',connecting:'Подключаю…',active:paused?'Микрофон на паузе':'Можно говорить',closing:'Завершаю…',closed:'Разговор завершён',redeeming:'Проверяю код…'}[phase];
 return <div className="health-talk-overlay"><section className="health-talk" ref={box} role="dialog" aria-modal="true" aria-labelledby="health-live-title" tabIndex={-1} onKeyDown={e=>{
  if(e.key==='Escape')close();
  if(e.key==='Tab'){const items=[...box.current.querySelectorAll('button:not(:disabled),input:not(:disabled),summary,a[href]')].filter(x=>x.getClientRects().length);
   if(e.shiftKey&&[items[0],box.current].includes(document.activeElement)){e.preventDefault();items.at(-1)?.focus();}
   else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}
 }}>
 <header><div><p className="health-talk-eyebrow">{module==='support'?'SUPPORT':'HEALTH'} · ТЕСТ</p><h2 id="health-live-title">Живое общение</h2></div><button aria-label="Закрыть разговор" onClick={close}>✕</button></header>
 <p>Один разговор — до трёх минут. Общий тестовый бюджет — до $1 на выданный код, включая голос и рассуждения. Он не пополняется автоматически.</p>
 <details><summary>Активировать тестовый код</summary><label>Код организатора теста<input value={code} onChange={e=>setCode(e.target.value)} disabled={busy} autoComplete="off" /></label><button disabled={busy||!code.trim()} onClick={redeem}>Активировать код</button>{codeNote&&<p role="status">{codeNote}</p>}</details>
 <label className="health-talk-check"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>Согласен передавать речь и контекст моего кабинета в OpenAI для этого разговора.</label>
 <div className="health-talk-status"><div className="health-talk-orb">🎙</div><span role="status">{label}</span></div>
 <button className="primary health-talk-main" disabled={['connecting','closing','redeeming'].includes(phase)||(!busy&&!consent)} onClick={()=>phase==='active'?toggle():start()}>{phase==='active'?(paused?'Говорите':'Я закончил'):phase==='connecting'?'Подключаю…':'Начать разговор'}</button>
 {['active','connecting'].includes(phase)&&<button onClick={end}>Завершить разговор</button>}
 {error&&<p className="health-talk-error" role="alert">{error}</p>}
 {transcript&&<div className="health-talk-transcript" aria-label="Текст ответа ИИ">{transcript}</div>}
 {reserved!==null&&<p>Зарезервировано: {reserved.toLocaleString('ru-RU')} кредитов. Подтверждённый неиспользованный остаток возвращается после разговора.</p>}
 {Number.isFinite(cost)&&<p>Учтённый расход: ${(cost/1000000).toFixed(3)}.</p>}
 <p>Расшифровка видна только здесь и не сохраняется в дневник.</p>
 <footer><span>ИИ не заменяет врача. Срочная помощь: <a href="tel:112">112</a> / <a href="tel:103">103</a>.</span><button onClick={()=>{close();onSpecialist?.();}}>Связаться со специалистом</button></footer>
 </section></div>;
}
