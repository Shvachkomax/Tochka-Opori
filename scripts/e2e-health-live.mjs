import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const support=process.env.LIVE_TEST_MODULE==='support';
const server=await createServer({server:{host:'127.0.0.1',port:5176,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
const page=await browser.newPage({viewport:{width:390,height:844}});let creates=0,redeems=0;
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{
  window.commands=[];window.tracks=[];
  navigator.mediaDevices.getUserMedia=async()=>{
   if(window.denyMic)throw new DOMException('denied','NotAllowedError');
   const track={enabled:true,readyState:'live',stop(){this.readyState='ended';},addEventListener(){}};
   window.tracks.push(track);return {getTracks:()=>[track]};
  };
  window.AudioContext=class {constructor(){this.sampleRate=24000;this.audioWorklet={addModule:async()=>{}};this.destination={};}async resume(){}async close(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}};
  window.AudioWorkletNode=class {constructor(){this.port={postMessage(){}};}connect(){}disconnect(){}};
  const RealSocket=window.WebSocket;
  window.WebSocket=class {
   constructor(url,...rest){if(String(url).includes('vite'))return new RealSocket(url,...rest);this.readyState=0;this.bufferedAmount=0;window.voiceSocket=this;setTimeout(()=>{this.readyState=1;this.onopen?.();},10);}
   send(raw){if(typeof raw!=='string')return;const e=JSON.parse(raw);window.commands.push(e);
    if(e.ticket)setTimeout(()=>{this.emit({type:'session.started'});this.emit({type:'session.output_transcript.delta',delta:'Давайте обсудим ваш день.'});},10);
    if(e.type==='session.close')setTimeout(()=>this.emit({type:'budget.closed',confirmed:true,charged_microusd:50000}),10);
   }
   emit(e){this.onmessage?.({data:JSON.stringify(e)});}
   close(){this.readyState=3;this.onclose?.();}
  };
 });
 await page.route('**/api/**',async route=>{
  if(route.request().url().includes('client-token'))return route.fulfill({json:{token:'fixture',expires_at:new Date(Date.now()+900000).toISOString()}});
  const body=route.request().postDataJSON();assert.equal(body.action,support?'supportLive':'healthLive');
  if(body.live_action==='redeem'){redeems++;return route.fulfill({json:{ok:true}});}
  if(body.live_action==='cancel')return route.fulfill({json:{ok:true}});
  assert.equal(body.transport,'server_ws');assert.equal(body.consent,true);creates++;
  return route.fulfill({status:201,json:{ticket:'opaque-ticket',socket_path:'/api/live-socket',reserved_credits:20000,max_seconds:180}});
 });
 await page.route('**/__live-test',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
import '/src/style.css';import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const {default:Live}=await import('/src/HealthLiveConversation.jsx');const root=ReactDOM.createRoot(document.getElementById('root'));root.render(React.createElement(Live,{module:'${support?'support':'body'}',sessionId:'fixture',accessToken:'fixture',onClose:()=>root.unmount()}));</script></body></html>`}));
 await page.goto('http://127.0.0.1:5176/__live-test');
 await page.getByText('Активировать тестовый код',{exact:true}).click();
 await page.getByLabel('Код организатора теста').fill('LIVE-'+'A'.repeat(32));
 await page.getByRole('button',{name:'Активировать код',exact:true}).click();
 await page.getByText('Тестовый доступ активирован.',{exact:false}).waitFor();assert.equal(redeems,1);
 assert.equal(await page.getByRole('button',{name:'Начать разговор'}).isDisabled(),true);
 await page.getByLabel('Согласен передавать речь',{exact:false}).check();
 await page.evaluate(()=>window.denyMic=true);await page.getByRole('button',{name:'Начать разговор'}).click();
 await page.getByRole('alert').filter({hasText:'Разрешите доступ'}).waitFor();assert.equal(creates,0);
 await page.evaluate(()=>window.denyMic=false);await page.getByRole('button',{name:'Начать разговор'}).click();
 await page.getByText('Давайте обсудим ваш день.',{exact:true}).waitFor();assert.equal(creates,1);
 await page.getByRole('button',{name:'Я закончил',exact:true}).click();
 await page.getByText('Микрофон на паузе',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.commands.some(x=>x.type==='session.close')),false);
 await page.getByRole('button',{name:'Говорите',exact:true}).click();
 await page.getByRole('button',{name:'Завершить разговор',exact:true}).click();
 await page.getByText('Учтённый расход:',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>window.tracks.every(x=>x.readyState==='ended')),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'Начать разговор'}).click();await page.getByText('Можно говорить',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Закрыть разговор',exact:true}).click();
 assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.evaluate(()=>window.tracks.every(x=>x.readyState==='ended')),true);
 assert.deepEqual(errors,[]);
 console.log(`${support?'Support':'Health'} browser PASS: code, consent, mic denial without reserve, websocket ticket, pause, close, microphone cleanup, mobile layout. Network/audio mocked.`);
}finally{await browser.close();await server.close();}
