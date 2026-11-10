import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runLiveRelay} from '../lib/voice/live-relay.js';
class Socket extends EventEmitter {
 constructor(){super();this.readyState=1;this.sent=[];this.bufferedAmount=0;}
 send(data){this.sent.push(Buffer.isBuffer(data)?data:JSON.parse(data));}
 close(){this.readyState=3;this.emit('close');}
 terminate(){this.close();}
 event(data){this.emit('message',Buffer.from(JSON.stringify(data)));}
}
const tick=()=>new Promise(r=>setImmediate(r));
async function setup({cap=1000000,claim=true,fetcher,persist}={}){
 const client=new Socket(),upstream=new Socket(),finished=[],order=[];
 const timers={timeouts:[],intervals:[],setTimeout(fn,ms){this.timeouts.push({fn,ms});return fn;},clearTimeout(){},setInterval(fn){this.intervals.push(fn);return fn;},clearInterval(){}};
 const done=runLiveRelay({client,ticket:{id:'test',config:{model:'gpt-live-1',input:[],delegation:{type:'client'}},backendInstructions:'Не назначай лечение.'},apiKey:'test',timers,
 budget:{async claim(){order.push('claim');return {ok:claim,reserved_microusd:cap};},async finish(...args){finished.push(args);if(persist)await persist();return {ok:true,charged_microusd:args[1]};}},
 connectProvider(){order.push('provider');return upstream;},providerFetch:fetcher||(async()=>{throw new Error('No paid requests expected');})});
 done.catch(()=>{});await tick();
 return {client,upstream,finished,order,timers,done};
}
let t=await setup({claim:false});await assert.rejects(t.done,/TICKET_USED/);assert.deepEqual(t.order,['claim']);
t=await setup();assert.deepEqual(t.order,['claim','provider']);t.upstream.emit('open');
assert.equal(t.upstream.sent[0].type,'session.start');assert.equal(t.upstream.sent[0].session.delegation.type,'client');
t.upstream.event({type:'session.started'});
t.client.emit('message',Buffer.from(JSON.stringify({type:'session.update',model:'expensive'})),false);
assert.equal(t.upstream.sent.some(x=>x.type==='session.update'),false);
assert.equal(t.upstream.sent.at(-1).type,'session.close');
t.upstream.event({type:'session.closed',usage:{seconds:12}});await t.done;
assert.deepEqual(t.finished[0],['test',10000,true]);
// Connection loss never refunds from the browser's account of usage.
t=await setup();t.upstream.emit('open');t.upstream.event({type:'session.started'});t.upstream.close();await t.done;
assert.deepEqual(t.finished[0],['test',1000000,false]);
// The server deadline fires even if the browser does nothing.
t=await setup();t.upstream.emit('open');t.upstream.event({type:'session.started'});
assert.equal(t.timers.timeouts[0].ms,180000);t.timers.timeouts[0].fn();assert.equal(t.upstream.sent.at(-1).type,'session.close');
t.timers.timeouts.at(-1).fn();await t.done;assert.equal(t.finished[0][2],false);
// Count first; insufficient reserve must never call paid Responses.
let endpoints=[];t=await setup({cap:50000,fetcher:async url=>{endpoints.push(url);return {ok:true,json:async()=>({input_tokens:1000})};}});
t.upstream.emit('open');t.upstream.event({type:'session.started'});t.upstream.event({type:'session.delegation.created',delegation:{id:'a'}});await tick();await tick();
assert.deepEqual(endpoints,['https://api.openai.com/v1/responses/input_tokens']);
assert.equal(t.upstream.sent.at(-1).type,'session.close');t.upstream.event({type:'session.closed',usage:{seconds:5}});await t.done;
// An authorized response is bounded, counted once and returned as commentary.
endpoints=[];t=await setup({fetcher:async(url,options)=>{
 endpoints.push(url);const body=JSON.parse(options.body);
 if(url.endsWith('input_tokens'))return {ok:true,json:async()=>({input_tokens:1000})};
 assert.equal(body.max_output_tokens,600);assert.equal(body.store,false);assert.equal(body.service_tier,'default');assert.deepEqual(body.tools,[]);
 return {ok:true,json:async()=>({usage:{input_tokens:1000,output_tokens:100},output:[{content:[{type:'output_text',text:'Расскажите, как прошёл ваш день.'}]}]})};
}});
t.upstream.emit('open');t.upstream.event({type:'session.started'});
t.upstream.event({type:'session.input_transcript.delta',delta:'Хочу поговорить о сне.'});
t.upstream.event({type:'session.delegation.created',delegation:{id:'a'}});await tick();await tick();
t.upstream.event({type:'session.delegation.created',delegation:{id:'a'}});await tick();
assert.equal(endpoints.length,2);assert.ok(t.upstream.sent.some(x=>x.type==='session.commentary.append'&&x.delegation_id==='a'));
t.upstream.event({type:'session.closed',usage:{seconds:60}});await t.done;assert.deepEqual(t.finished[0],['test',58000,true]);
// Paid response timeout keeps full reserve, even if voice finalization succeeds.
t=await setup({fetcher:async url=>{if(url.endsWith('input_tokens'))return {ok:true,json:async()=>({input_tokens:1000})};throw new Error('timeout');}});
t.upstream.emit('open');t.upstream.event({type:'session.started'});t.upstream.event({type:'session.delegation.created',delegation:{id:'a'}});await tick();await tick();
t.upstream.event({type:'session.closed',usage:{seconds:1}});await t.done;assert.deepEqual(t.finished[0],['test',1000000,false]);
console.log('PASS: relay refuses unreserved calls, blocks forged events, server deadline, disconnect, budget preflight, bounded backend, duplicate delegation and uncertain paid usage. No provider network.');

// Persistence outage must not keep the billable upstream alive.
let release;const held=new Promise(resolve=>{release=resolve;});
t=await setup({persist:()=>held});t.upstream.emit('open');
t.timers.timeouts[0].fn();t.timers.timeouts.at(-1).fn();await tick();
assert.equal(t.upstream.readyState,3);release();await t.done;
console.log('PASS: upstream disconnect precedes blocked database persistence.');
