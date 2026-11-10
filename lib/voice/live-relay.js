import { LIVE_MAX_SECONDS, LIVE_CLOSE_GRACE_SECONDS, LIVE_MAX_OUTPUT_TOKENS, LIVE_BACKEND_MODEL, voiceCost, backendCost } from './live-budget.js';

// Only this trusted server owns the primary provider socket and paid backend calls.
// No keys, session.update, response.create, or arbitrary events from the browser.
export async function runLiveRelay({ client, ticket, budget, connectProvider, providerFetch=fetch, apiKey, clock=Date.now, timers=globalThis }) {
  const claim = await budget.claim(ticket.id);
  if (!claim.ok) throw new Error('TICKET_USED_OR_EXPIRED');
  const cap = claim.reserved_microusd;
  const secondsLimit = Math.min(LIVE_MAX_SECONDS,Math.floor(cap*60/50000)-LIVE_CLOSE_GRACE_SECONDS);
  if (secondsLimit<15) { await budget.finish(ticket.id,0,false); throw new Error('BUDGET_EXHAUSTED'); }
  const voiceReserve = voiceCost(secondsLimit+LIVE_CLOSE_GRACE_SECONDS);
  let backendSpent=0, backendHold=0, lastActivity=clock();
  let closing=false, finished=false, started=false, provider, pending=false, uncertain=false;
  let latestVoice=0, history='', closeTimer, deadlineTimer, idleTimer;
  const seen = new Set();
  const abort = new AbortController();
  const emit = event => { if(client.readyState===1) client.send(JSON.stringify(event)); };
  const send = event => { if(provider?.readyState===1) provider.send(JSON.stringify(event)); };
  const finalPromise = new Promise(resolve => { client.liveResolve = resolve; });
  async function finish(confirmed) {
    if(finished) return; finished=true; abort.abort();
    timers.clearTimeout(deadlineTimer); timers.clearTimeout(closeTimer); timers.clearInterval(idleTimer);
    // Cut off paid transport before any database I/O, even if persistence hangs.
    provider?.terminate?.();
    const valid = confirmed && !uncertain && !pending;
    const cost = valid ? voiceCost(latestVoice)+backendSpent : cap;
    try {
      const result = await budget.finish(ticket.id,cost,valid);
      emit({type:'budget.closed',...result,confirmed:valid});
    } catch { emit({type:'budget.error',message:'Итоговые расходы не подтверждены. Бюджет остаётся зарезервирован.'}); }
    if(client.readyState===1) client.close();
    client.liveResolve();
  }
  function stop(reason='closed') {
    if(closing||finished)return; closing=true;
    emit({type:'budget.stopping',reason});
    send({type:'session.close'});
    closeTimer=timers.setTimeout(()=>finish(false),LIVE_CLOSE_GRACE_SECONDS*1000);
  }
  client.on('close',()=>stop('client_disconnected'));
  client.on('error',()=>stop('client_error'));
  deadlineTimer=timers.setTimeout(()=>stop('time_limit'),secondsLimit*1000);
  idleTimer=timers.setInterval(()=>{if(!pending&&clock()-lastActivity>60000)stop('idle');},1000);
  // No audio buffering beyond a second; backpressure ends the connection.
  let windowStart=clock(), windowBytes=0;
  client.on('message',(data,isBinary)=>{
    if(!started||closing||finished)return;
    if(isBinary) {
      if(data.length>48000||data.length%2) return stop('invalid_audio');
      if(clock()-windowStart>=1000){windowStart=clock();windowBytes=0;}
      windowBytes+=data.length;
      if(windowBytes>96000 || provider.bufferedAmount>192000) return stop('audio_backpressure');
      send({type:'session.input_audio.append',audio:Buffer.from(data).toString('base64')});
      return;
    }
    let e;try{e=JSON.parse(data.toString());}catch{return stop('invalid_event');}
    if(e.type==='session.close')stop('user_closed');
    // Reject, rather than proxy, all other commands (including budget reports).
    else stop('invalid_event');
  });
  async function delegate(id) {
    if(!id||seen.has(id)||closing||finished)return;
    seen.add(id);
    if(pending)return stop('concurrent_backend');
    pending=true;
    const headers={Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'};
    const input=[...ticket.config.input,{role:'user',content:history.slice(-24000)}];
    const countBody={model:LIVE_BACKEND_MODEL,instructions:ticket.backendInstructions,input,tools:[]};
    try {
      const countResponse=await providerFetch('https://api.openai.com/v1/responses/input_tokens',{method:'POST',headers,body:JSON.stringify(countBody),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});
      if(!countResponse.ok) throw new Error('COUNT_FAILED');
      const count=(await countResponse.json()).input_tokens;
      if(!Number.isSafeInteger(count)||count<0||count>64000)throw new Error('INPUT_LIMIT');
      const required=backendCost({input_tokens:count,output_tokens:LIVE_MAX_OUTPUT_TOKENS});
      if(closing||finished)return;
      if(voiceReserve+backendSpent+required>cap){pending=false;stop('budget_exhausted');return;}
      backendHold=required;
      send({type:'session.thinking.append',event_id:`quiet_${id}`,delegation_id:id,content:''});
      const response=await providerFetch('https://api.openai.com/v1/responses',{method:'POST',headers,
        body:JSON.stringify({...countBody,store:false,service_tier:'default',max_output_tokens:LIVE_MAX_OUTPUT_TOKENS,tool_choice:'none'}),
        signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])});
      if(!response.ok)throw new Error('BACKEND_FAILED');
      const result=await response.json(), cost=backendCost(result.usage);
      if(cost>required)throw new Error('ESTIMATE_EXCEEDED');
      backendSpent+=cost;backendHold=0;
      const answer=(result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
      if(!closing&&!finished&&answer){
        // At most 500 tokens per append: <=450 UTF-8 bytes is a conservative bound.
        let chunk='';for(const character of answer){if(Buffer.byteLength(chunk+character)>450){send({type:'session.commentary.append',delegation_id:id,content:chunk});chunk='';}chunk+=character;}
        if(chunk)send({type:'session.commentary.append',delegation_id:id,content:chunk});
      }
      emit({type:'budget.usage',backend_microusd:backendSpent,voice_microusd:voiceCost(latestVoice),limit_microusd:cap});
    } catch {
      if(backendHold){backendSpent+=backendHold;backendHold=0;uncertain=true;}
      stop('backend_unavailable');
    } finally {pending=false;lastActivity=clock();}
  }
  try {
    if(client.readyState!==1){await finish(true);return finalPromise;}
    provider=connectProvider(apiKey);
    provider.on('open',()=>{
      if(closing||finished){provider.terminate();finish(false);return;}
      send({type:'session.start',session:ticket.config});
    });
    provider.on('message',raw=>{
      let e;try{e=JSON.parse(raw.toString());}catch{return stop('provider_protocol');}
      if(finished)return;
      if(e.type==='session.started'){started=true;emit({type:'session.started',max_seconds:secondsLimit});}
      if(e.type==='session.input_transcript.delta'||e.type==='session.output_transcript.delta'){
        if(typeof e.delta==='string'){history=(history+`\n${e.type.includes('input_')?'Пользователь':'Помощник'}: ${e.delta}`).slice(-24000);lastActivity=clock();emit({type:e.type,delta:e.delta});}
      }
      if(e.type==='session.output_audio.delta'){
        lastActivity=clock();
        if(client.bufferedAmount>192000)return stop('playback_backpressure');
        if(typeof e.delta==='string'&&client.readyState===1)client.send(Buffer.from(e.delta,'base64'));
      }
      if(['session.usage.updated','session.closed'].includes(e.type)){
        if(Number.isFinite(e.usage?.seconds)&&e.usage.seconds>=latestVoice)latestVoice=e.usage.seconds;
        else if(e.type==='session.closed')uncertain=true;
        if(voiceCost(latestVoice)+backendSpent+backendHold>cap){uncertain=true;stop('cost_overrun');}
      }
      if(e.type==='session.delegation.created')void delegate(e.delegation?.id);
      if(e.type==='session.closed')void finish(true);
      if(e.type==='error')stop('provider_error');
    });
    provider.on('close',()=>{if(!finished)void finish(false);});
    provider.on('error',()=>stop('provider_error'));
  } catch { await finish(false); }
  return finalPromise;
}
