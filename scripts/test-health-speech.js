import assert from 'node:assert/strict';
process.env.CLIENT_API_SIGNING_SECRET = 'test-only-health-voice-signing-secret';
process.env.HEALTH_VOICE_ENABLED = 'true';
process.env.OPENAI_API_KEY = 'test-only';
const { createSpeechTicket, verifySpeechTicket, speechText } = await import('../lib/voice/speech-ticket.js');
const { createHandler } = await import('../lib/voice/health-speech.js');
const { generateClientToken } = await import('../lib/security/client-token.js');
const text = speechText({ answer: 'Ответ.', safety_note: 'Предупреждение.', small_next_step: 'Шаг.' });
assert.equal(text, 'Ответ.\n\nПредупреждение.\n\nШаг.');
const ticket = createSpeechTicket('health-test', text);
assert.ok(verifySpeechTicket(ticket, 'health-test', text));
assert.equal(verifySpeechTicket(ticket, 'other', text), false);
assert.equal(verifySpeechTicket(ticket, 'health-test', text + 'изменено'), false);
assert.equal(verifySpeechTicket(ticket, 'health-test', text, Date.now() + 601_000), false);
assert.equal(verifySpeechTicket(ticket + 'x', 'health-test', text), false);
assert.equal(verifySpeechTicket('invalid', 'health-test', text), false);
let upstreamCalls = 0;
const handler = createHandler({
  validateAccess: async (sid, token) => sid === 'health-test' && token === 'owned',
  upstreamFetch: async (_url, options) => {
    upstreamCalls++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.response_format, 'mp3');
    return { ok: true, arrayBuffer: async () => new Uint8Array([73, 68, 51]).buffer };
  },
});
async function request(body, module = 'body', headers = {}) {
  const req = { method: 'POST', url: '/api/health-speech', headers: { authorization: `Bearer ${generateClientToken('analyze', module).token}`, ...headers }, body };
  const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, setHeader(k,v) { this.headers[k] = v; }, json(d) { this.data=d; return this; }, send(d) { this.data=d; return this; } };
  await handler(req, res); return res;
}
const body = { session_id: 'health-test', access_token: 'owned', action: 'speak', text, ticket };
assert.equal((await request(body)).code, 200);
assert.equal((await request({ ...body, access_token: 'wrong' })).code, 403);
assert.equal((await request(body, 'support')).code, 403);
assert.equal((await request({ ...body, text: 'Чужой текст' })).code, 400);
assert.equal((await request(body, 'body', { authorization: 'Bearer bad' })).code, 401);
assert.equal((await request(body, 'body', { origin: 'https://evil.example' })).code, 403);
process.env.ANMED_SUPPORT_ONLY = 'true';
assert.equal((await request(body)).code, 403);
delete process.env.ANMED_SUPPORT_ONLY;
process.env.HEALTH_VOICE_ENABLED = 'false';
assert.equal((await request(body)).code, 503);
assert.equal(createSpeechTicket('health-test', text), null);
process.env.HEALTH_VOICE_ENABLED = 'true';
const test = await request({ ...body, action: 'test', ticket: null });
assert.equal(test.code, 200); assert.equal(test.headers['Cache-Control'], 'no-store');
assert.equal(upstreamCalls, 2);
const failing = createHandler({ validateAccess: async () => true, upstreamFetch: async () => { throw new Error('secret must not leak'); } });
const res = { status(c) { this.code = c; return this; }, setHeader(){}, json(d){this.data=d;} };
await failing({ method:'POST', headers:{authorization:`Bearer ${generateClientToken('analyze','body').token}`}, body }, res);
assert.equal(res.code, 503); assert.ok(!JSON.stringify(res.data).includes('secret'));
// Verify the deployed /api/session dispatcher reaches the same protected handler.
const { default: sessionHandler } = await import('../api/session.js');
const routed = { status(c) { this.code = c; return this; }, setHeader(){}, json(d){this.data=d;} };
await sessionHandler({ method:'POST', headers:{authorization:'Bearer bad'}, body:{action:'healthSpeech',speech_action:'test'} }, routed);
assert.equal(routed.code, 401);
// Node/Vercel requests expose fields through prototype getters, not enumerable
// own properties. Object spreading such a request silently loses its headers.
const runtimeRequest = Object.create(Object.defineProperties({}, {
  method: { get: () => 'POST' },
  headers: { get: () => ({ authorization: 'Bearer bad', origin: 'https://health.tochka-opori.online' }) },
  url: { get: () => '/api/session' },
  socket: { get: () => ({ remoteAddress: '127.0.0.1' }) },
}));
runtimeRequest.body = { action: 'healthSpeech', speech_action: 'test' };
const runtimeResponse = { status(c) { this.code = c; return this; }, setHeader(){}, json(d){this.data=d;} };
await sessionHandler(runtimeRequest, runtimeResponse);
assert.equal(runtimeResponse.code, 401);
runtimeRequest.body.access_token = 'fixture';
Object.defineProperty(runtimeRequest, 'headers', { value: { authorization: `Bearer ${generateClientToken('analyze','body').token}` } });
await sessionHandler(runtimeRequest, runtimeResponse);
assert.equal(runtimeResponse.code, 403); // Reaches session validation, no DB write.
console.log('Health speech: signing, expiry, ownership, module, origin, kill switch and upstream failure PASS');
// Existing rate-limit module owns a housekeeping interval.
process.exit(0);
