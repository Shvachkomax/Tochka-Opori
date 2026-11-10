import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { deploymentOrganizationId } from '../security/deployment-scope.js';
import { getSupabase } from '../supabase.js';

export const LIVE_BUDGET_MICROUSD = 1_000_000;
export const LIVE_CREDITS_PER_DOLLAR = 20_000;
export const LIVE_MAX_SECONDS = 180;
export const LIVE_CLOSE_GRACE_SECONDS = 20;
export const LIVE_AUDIO_MICROUSD_PER_MINUTE = 50_000;
export const LIVE_BACKEND_MODEL = 'gpt-5.5';
export const LIVE_MAX_OUTPUT_TOKENS = 600;
// Standard, non-priority, <=272k context pricing. No tools or other models.
export const LIVE_INPUT_MICROUSD_PER_TOKEN = 5;
export const LIVE_OUTPUT_MICROUSD_PER_TOKEN = 30;
export function voiceCost(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('INVALID_USAGE');
  return Math.ceil(seconds * LIVE_AUDIO_MICROUSD_PER_MINUTE / 60);
}
export function backendCost(usage) {
  const { input_tokens: input, output_tokens: output } = usage || {};
  if (!Number.isSafeInteger(input) || input < 0 || input > 64000 || !Number.isSafeInteger(output) || output < 0 || output > LIVE_MAX_OUTPUT_TOKENS) throw new Error('INVALID_USAGE');
  // Charge uncached input conservatively; never undercharge by trusting client cache figures.
  return input * LIVE_INPUT_MICROUSD_PER_TOKEN + output * LIVE_OUTPUT_MICROUSD_PER_TOKEN;
}
export function budgetScope() {
  if (!process.env.LIVE_BUDGET_SCOPE) throw new Error('BUDGET_SCOPE_MISSING');
  return process.env.LIVE_BUDGET_SCOPE;
}
function secret() {
  if (!process.env.CLIENT_API_SIGNING_SECRET) throw new Error('BUDGET_SECRET_MISSING');
  return process.env.CLIENT_API_SIGNING_SECRET;
}
export function hashLiveCode(code, scope = budgetScope()) {
  if (typeof code !== 'string' || !/^LIVE-[A-Z0-9]{32}$/.test(code.trim().toUpperCase())) throw new Error('INVALID_CODE');
  return createHash('sha256').update(`live-code:v1:${scope}:${code.trim().toUpperCase()}`).digest('hex');
}
export function newLiveCode() { return `LIVE-${randomBytes(16).toString('hex').toUpperCase()}`; }
function ticketAudience() { return `${process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'local'}:${deploymentOrganizationId() || 'default'}`; }
function ticketKey(scope) { return createHash('sha256').update(`live-ticket:v1:${scope}:${secret()}`).digest(); }
export function sealTicket(payload, scope = budgetScope()) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', ticketKey(scope), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify({ ...payload, scope, audience: ticketAudience(), expires: Date.now()+40_000 })),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),content]).toString('base64url');
}
export function openTicket(ticket, scope = budgetScope()) {
  if (typeof ticket !== 'string' || ticket.length > 200000) throw new Error('INVALID_TICKET');
  const raw = Buffer.from(ticket,'base64url');
  const decipher = createDecipheriv('aes-256-gcm',ticketKey(scope),raw.subarray(0,12));
  decipher.setAuthTag(raw.subarray(12,28));
  const p = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString());
  if (p.audience !== ticketAudience() || p.scope !== scope || !Number.isSafeInteger(p.expires) || p.expires <= Date.now() || p.expires > Date.now()+45_000) throw new Error('EXPIRED_TICKET');
  return p;
}
export function createBudgetStore(db = getSupabase(), scope = budgetScope()) {
  async function rpc(name,args) {
    const {data,error} = await db.rpc(name,{p_scope:scope,...args});
    if (error || !data) throw new Error('BUDGET_UNAVAILABLE');
    return data;
  }
  return {
    redeem: (ownerId,module,code) => rpc('live_budget_bind',{p_owner_id:ownerId,p_module:module,p_code_hash:hashLiveCode(code,scope)}),
    reserve: (ownerId,module,id=randomUUID()) => rpc('live_budget_reserve',{p_owner_id:ownerId,p_module:module,p_id:id}),
    claim: id => rpc('live_budget_claim',{p_id:id}),
    finish: (id,cost,confirmed,unstarted=false) => rpc('live_budget_finish',{p_id:id,p_cost:cost,p_confirmed:confirmed,p_unstarted:unstarted}),
  };
}
export const BUDGET_MESSAGES = {
 ACCESS_REQUIRED:'Введите тестовый код доступа к живому общению.',
 INVALID_CODE:'Код не найден или срок его действия истёк.',
 CODE_USED:'Этот код уже привязан к другому кабинету.',
 ALREADY_BOUND:'Кабинет уже связан с другим тестовым кодом.',
 CONVERSATION_PENDING:'Предыдущий разговор ещё не завершён или его расходы требуют проверки. Новый пока недоступен.',
 WALLET_UNAVAILABLE:'Кошелёк недоступен. Обратитесь к организатору теста.',
 BUDGET_EXHAUSTED:'Тестовый бюджет исчерпан. Новые разговоры недоступны.',
};
