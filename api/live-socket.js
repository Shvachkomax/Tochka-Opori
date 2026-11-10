import { livePilotEnabled } from '../lib/voice/health-live.js';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { applyCors } from '../lib/security/cors.js';
import { rejectUnavailableModule } from '../lib/security/module-availability.js';
import { createBudgetStore, openTicket } from '../lib/voice/live-budget.js';
import { runLiveRelay } from '../lib/voice/live-relay.js';

const server=createServer((_req,res)=>{res.writeHead(426);res.end('WebSocket required');});
const sockets=new WebSocketServer({noServer:true,maxPayload:200000,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
 const response={setHeader(){},status(){return this;},json(){}};
 if(!(livePilotEnabled(process.env,'body') || livePilotEnabled(process.env,'support')) || !req.headers.origin || !applyCors(req,response) || process.env.LIVE_BUDGET_RELAY_ENABLED!=='true'){
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
 }
 sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws));
});
sockets.on('connection',client=>{
 const timer=setTimeout(()=>client.close(1008,'Authentication required'),5000);
 client.once('message',async(raw,isBinary)=>{
  clearTimeout(timer);
  try {
   if(isBinary)throw new Error('INVALID_TICKET');
   const message=JSON.parse(raw.toString());
   const ticket=openTicket(message.ticket);
   const flag=ticket.module==='support'?'SUPPORT_LIVE_ENABLED':'HEALTH_LIVE_ENABLED';
   if(!['support','body'].includes(ticket.module)||process.env[flag]!=='true')throw new Error('DISABLED');
   const response={status(){return this;},json(){}};
   if(rejectUnavailableModule(response,ticket.module))throw new Error('MODULE_DISABLED');
   if(!livePilotEnabled(process.env,ticket.module))throw new Error('LIVE_DISABLED');
   const apiKey=process.env.OPENAI_API_KEY || (process.env.VERCEL_PROJECT_ID === 'prj_BSzyfSJjjrCTI0RieWuVxR8qh3el' ? process.env.OPENAI_API_KEY_test : undefined);
   if(!apiKey)throw new Error('PROVIDER_UNAVAILABLE');
   await runLiveRelay({client,ticket,budget:createBudgetStore(),apiKey,
    connectProvider:key=>new WebSocket('wss://api.openai.com/v1/live/sessions',{headers:{Authorization:`Bearer ${key}`},maxPayload:1000000,handshakeTimeout:10000})});
  } catch {
   if(client.readyState===1){client.send(JSON.stringify({type:'budget.error',message:'Разговор недоступен. Обновите кабинет или обратитесь к организатору теста.'}));client.close(1008);}
  }
 });
 client.on('error',()=>clearTimeout(timer));
 client.on('close',()=>clearTimeout(timer));
});
export default server;
