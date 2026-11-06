import assert from 'node:assert/strict';
import { runPreviewSmoke } from './langfuse-preview-smoke.js';

const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/langfuse-test-observability',
  DEPLOYMENT_PURPOSE: 'test', AI_TELEMETRY_ENABLED: 'true', LANGFUSE_BASE_URL: 'https://us.cloud.langfuse.com',
  LANGFUSE_PUBLIC_KEY: 'synthetic-public', LANGFUSE_SECRET_KEY: 'synthetic-secret' };
assert.deepEqual(await runPreviewSmoke({ env: { ...env, VERCEL_ENV: 'production' } }), { status: 'skipped' });
let ended = false, stopped = false, reads = 0;
const runtimeFactory = async () => ({
  start: attrs => {
    assert.equal(attrs.metadata.synthetic, true);
    assert.equal('input' in attrs, false);
    return { id: 'synthetic-observation', traceId: 'synthetic-trace', update: () => {}, end: () => { ended = true; } };
  },
  flush: async () => { assert.equal(ended, true); },
  shutdown: async () => { stopped = true; },
});
const request = async (url, init) => {
  reads++;
  assert.equal(url.origin, 'https://us.cloud.langfuse.com');
  assert.equal(url.pathname, '/api/public/v2/observations');
  assert.equal(url.searchParams.get('traceId'), 'synthetic-trace');
  assert.equal(init.redirect, 'error');
  return new Response(JSON.stringify({ data: [{ id: 'synthetic-observation', traceId: 'synthetic-trace', input: null, output: null }] }));
};
const result = await runPreviewSmoke({ env, runtimeFactory, request });
assert.equal(result.status, 'verified');
assert.equal(stopped, true);
assert.equal(reads, 1);
await assert.rejects(() => runPreviewSmoke({ env: { ...env, DEPLOYMENT_PURPOSE: 'live' } }), /CONFIGURATION/);
await assert.rejects(() => runPreviewSmoke({ env, runtimeFactory, request: async () => new Response('', { status: 401 }) }), /HTTP_401/);
await assert.rejects(() => runPreviewSmoke({ env, runtimeFactory,
  request: async () => new Response(JSON.stringify({ data: [{ id: 'synthetic-observation', traceId: 'synthetic-trace', input: 'unexpected', output: null }] })) }), /UNEXPECTED_CONTENT/);
console.log('Preview smoke PASS: scoped synthetic readback, no production, no paid AI, error handling.');
