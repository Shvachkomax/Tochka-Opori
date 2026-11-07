import assert from 'node:assert/strict';
import { createAiTelemetry, createLangfuseRuntime, telemetryConfiguration } from '../lib/observability/ai-telemetry.js';
import { normalizeOpenAiUsage, langfuseUsage } from '../lib/observability/usage.js';

const env = { AI_TELEMETRY_ENABLED: 'true', DEPLOYMENT_PURPOSE: 'test',
  LANGFUSE_BASE_URL: 'https://cloud.langfuse.com', LANGFUSE_PUBLIC_KEY: 'synthetic-public', LANGFUSE_SECRET_KEY: 'synthetic-secret' };
assert.equal(telemetryConfiguration({ ...env, AI_TELEMETRY_ENABLED: '' }), null);
assert.equal(telemetryConfiguration({ ...env, DEPLOYMENT_PURPOSE: 'live' }), null);
assert.equal(telemetryConfiguration({ ...env, LANGFUSE_SECRET_KEY: '' }), null);
for (const url of ['http://cloud.langfuse.com', 'https://user:password@example.test', 'https://example.test/?secret=x', 'https://example.test/path']) {
  assert.equal(telemetryConfiguration({ ...env, LANGFUSE_BASE_URL: url }), null);
}
assert.equal(telemetryConfiguration({ ...env, VERCEL_ENV: 'production' }), null);
assert.equal(telemetryConfiguration(env).baseUrl, 'https://cloud.langfuse.com');

const usage = normalizeOpenAiUsage({ input_tokens: 100, output_tokens: 50, total_tokens: 150,
  input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 30 } }, 'responses');
assert.deepEqual(langfuseUsage(usage), { input: 80, input_cached_tokens: 20, output: 50 });
assert.equal(usage.reasoning_tokens, 30);
assert.deepEqual(langfuseUsage(normalizeOpenAiUsage(undefined, 'responses')), {});
assert.deepEqual(langfuseUsage(normalizeOpenAiUsage({ prompt_tokens: 0, completion_tokens: 0 }, 'chat_completions')), { input: 0, output: 0 });
assert.equal(normalizeOpenAiUsage({ input_tokens: -1, output_tokens: '5' }, 'responses').input_tokens, null);
assert.equal(normalizeOpenAiUsage({ input_tokens: 4, input_tokens_details: { cached_tokens: 9 } }, 'responses').cached_input_tokens, null);

let calls = 0;
const result = { raw: 'PRIVATE_OUTPUT_CANARY', parsed: { private: true }, model_used: 'gpt-4.1-mini', ...usage };
const perform = async () => { calls++; return result; };
const disabled = createAiTelemetry({ env: {}, loadSdk: () => { throw new Error('must not initialize'); } });
assert.equal(await disabled({ model: 'gpt-4.1-mini' }, perform), result);
assert.equal(calls, 1);

const warnings = [];
const originalWarn = console.warn;
console.warn = (...values) => warnings.push(values.join(' '));
try {
  const failedInit = createAiTelemetry({ env, loadSdk: async () => { throw new Error('PRIVATE_INIT_ERROR'); } });
  assert.equal(await failedInit({ model: 'gpt-4.1-mini' }, perform), result);
  const brokenRuntime = createAiTelemetry({ env, loadSdk: async () => ({
    start: () => ({ update: () => { throw new Error('PRIVATE_UPDATE_ERROR'); }, end: () => { throw new Error('PRIVATE_END_ERROR'); } }),
    flush: async () => { throw new Error('PRIVATE_EXPORT_ERROR'); },
  }) });
  assert.equal(await brokenRuntime({ model: 'gpt-4.1-mini' }, perform), result);
  const hungInit = createAiTelemetry({ env, loadSdk: () => new Promise(() => {}) });
  assert.equal(await hungInit({ model: 'gpt-4.1-mini' }, perform), result);
  const hungFlush = createAiTelemetry({ env, loadSdk: async () => ({
    start: () => ({ update() {}, end() {} }), flush: () => new Promise(() => {}),
  }) });
  assert.equal(await hungFlush({ model: 'gpt-4.1-mini' }, perform), result);
  assert.equal(calls, 5); // Export/update/init failures must never retry a paid operation.
} finally { console.warn = originalWarn; }
assert.equal(warnings.some(value => value.includes('PRIVATE_')), false);

// Exercise the actual Langfuse SDK and processor with an in-memory exporter.
// All network calls are forbidden: no cloud account or OpenAI request is involved.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network forbidden in isolated telemetry test'); };
const spans = [];
let runtime;
try {
  runtime = await createLangfuseRuntime(telemetryConfiguration(env), { exporter: {
    export: (batch, done) => { spans.push(...batch); done({ code: 0 }); },
    shutdown: async () => {},
    forceFlush: async () => {},
  } });
  const observed = createAiTelemetry({ env, loadSdk: async () => runtime });
  assert.equal(await observed({ model: 'gpt-4.1-mini', taskType: 'patient_dialog', prompt: 'PRIVATE_INPUT_CANARY', patientId: 'PRIVATE_PATIENT_CANARY' }, perform), result);
  const providerError = Object.assign(new Error('PRIVATE_ERROR_CANARY'), { code: 'rate_limit_exceeded' });
  await assert.rejects(() => observed({ model: 'gpt-4.1-mini' }, async () => { throw providerError; }), error => error === providerError);
  const unknownError = Object.assign(new Error('PRIVATE_EXCEPTION'), { code: 'PRIVATE_CODE_CANARY' });
  await assert.rejects(() => observed({ model: 'gpt-4.1-mini' }, async () => { throw unknownError; }), error => error === unknownError);
  assert.equal(spans.length, 3);
  const exported = JSON.stringify(spans.map(span => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })));
  assert.equal(exported.includes('PRIVATE_'), false);
  assert.equal(exported.includes('rate_limit_exceeded'), true);
  assert.equal(exported.includes('provider_request_failed'), true);
  assert.equal(exported.includes('input_cached_tokens'), true);
  assert.equal(exported.includes('reasoning_tokens'), true);
  assert.equal(spans.every(span => span.name === 'ai.provider-request'), true);
  assert.equal(new Set(spans.map(span => span.spanContext().traceId)).size, 3);
} finally {
  await runtime?.shutdown();
  globalThis.fetch = originalFetch;
}
console.log('AI telemetry PASS: configuration isolation, usage, failure tolerance, real SDK export and privacy (no network).');
