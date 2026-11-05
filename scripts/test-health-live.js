import assert from 'node:assert/strict';
process.env.CLIENT_API_SIGNING_SECRET = 'test-only-live-key';
process.env.HEALTH_LIVE_ENABLED = 'true';
process.env.OPENAI_API_KEY = 'test-only';
const { createLiveHandler, liveConfiguration } = await import('../lib/voice/health-live.js');
const { generateClientToken } = await import('../lib/security/client-token.js');
let calls = 0, upstreamOk = true;
function makeHandler(module = 'body') { return createLiveHandler({
  module,
  resolveOwner: async (id, token) => id === 'health-test' && token === 'owned' ? { ownerId: 'fixture' } : null,
  buildContext: async () => ({ profile: { goal: 'Наладить сон' } }),
  upstreamFetch: async (url, options) => {
    calls++;
    if (url.includes('/models/')) return { ok: upstreamOk };
    const body = JSON.parse(options.body);
    assert.equal(body.session.model, 'gpt-live-1');
    assert.equal(body.session.store, false);
    assert.equal(body.session.delegation.responses.model, 'gpt-5.5');
    assert.deepEqual(body.session.client.data_channel.allowed_client_events, ['session.close']);
    return { ok: upstreamOk, status: 403, json: async () => ({ session: { id: 'live_test', secret: 'must-not-leak' }, transport: { sdp: 'answer' } }) };
  },
}); }
let handler = makeHandler();
let ip = 0;
async function call(extra = {}, module = 'body', headers = {}) {
  const req = { method: 'POST', url: '/api/session', headers: { authorization: `Bearer ${generateClientToken('analyze', module).token}`, 'x-forwarded-for': `test-${ip++}`, ...headers }, body: { session_id: 'health-test', access_token: 'owned', live_action: 'create', consent: true, sdp: 'v=0\r\nfixture', ...extra } };
  const res = { status(c) { this.code = c; return this; }, setHeader(){}, json(d){ this.data = d; return this; } };
  await handler(req, res); return res;
}
assert.equal((await call({ access_token: 'wrong' })).code, 403);
assert.equal((await call({}, 'support')).code, 403);
assert.equal((await call({}, 'body', { origin: 'https://evil.example' })).code, 403);
assert.equal((await call({}, 'body', { authorization: 'Bearer invalid' })).code, 401);
assert.equal(calls, 0);
assert.equal((await call({ consent: false })).code, 400);
assert.equal((await call({ sdp: 'x'.repeat(65000) })).code, 400);
assert.equal(calls, 0);
process.env.VERCEL_ENV = 'production';
assert.equal((await call()).code, 503);
delete process.env.VERCEL_ENV;
process.env.HEALTH_LIVE_ENABLED = 'false';
assert.equal((await call()).code, 503);
process.env.HEALTH_LIVE_ENABLED = 'true';
const created = await call({ model: 'untrusted', instructions: 'untrusted' });
assert.equal(created.code, 201);
assert.equal(created.data.max_seconds, 300);
assert.equal(JSON.stringify(created.data).includes('must-not-leak'), false);
assert.equal((await call({ live_action: 'check' })).code, 200);
upstreamOk = false;
assert.equal((await call({ live_action: 'check' })).code, 503);
assert.equal((await call()).code, 502);
const config = liveConfiguration({ comment: 'my email is test@example.com' });
assert.equal(JSON.stringify(config.input).includes('test@example.com'), false);
assert.deepEqual(config.delegation.responses.tools, []);
assert.ok(config.instructions.includes('Не ставь диагнозы'));
upstreamOk = true;
process.env.SUPPORT_LIVE_ENABLED = 'true';
handler = makeHandler('support');
assert.equal((await call({}, 'body')).code, 403);
assert.equal((await call({}, 'support')).code, 201);
assert.equal((await call({ access_token: 'wrong' }, 'support')).code, 403);
process.env.VERCEL_ENV = 'production';
process.env.VERCEL_PROJECT_ID = 'prj_SeESCUVqpuz1yNdfsbZohp1eFGIx';
assert.equal((await call({}, 'support')).code, 503);
for (const project of ['prj_BSzyfSJjjrCTI0RieWuVxR8qh3el', 'prj_FoIS93e41JhmwhcmQKmnKwXDQgjv', 'prj_H6uhvcFyZa5VFruMZ23MVUF5Igpv', 'prj_E5bcy3n00Mv3szU6ZdHwbIXrPvUL', 'prj_l0gddWYlTlMB09OXDVzU7gWrY1mA']) {
  process.env.VERCEL_PROJECT_ID = project;
  assert.equal((await call({}, 'support')).code, 201);
}
process.env.SUPPORT_ONLY = 'true';
process.env.ANMED_SUPPORT_ONLY = 'true';
handler = makeHandler('body');
assert.equal((await call()).code, 403);
const support = liveConfiguration({}, 'support');
assert.ok(support.instructions.includes('ИИ-помощник Support'));
assert.ok(support.instructions.includes('НЕ продолжай обычный диалог'));
assert.ok(support.instructions.includes('Ты не назначаешь лекарства'));
assert.ok(!support.instructions.includes('ИИ-помощник Health'));
console.log('Support + Health test-project routing PASS');
console.log('Health Live PASS: authentication, ownership, origin, consent, disabled/production gates, model access errors, server-only config, masking, no writable tools. Provider mocked.');
process.exit(0);
