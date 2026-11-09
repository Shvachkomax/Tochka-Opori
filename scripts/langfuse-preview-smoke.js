import { pathToFileURL } from 'node:url';
import { createLangfuseRuntime, telemetryConfiguration } from '../lib/observability/ai-telemetry.js';

export async function runPreviewSmoke({ env = process.env, runtimeFactory = createLangfuseRuntime,
  request = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== 'feat/langfuse-test-observability') {
    return { status: 'skipped' };
  }
  const config = telemetryConfiguration(env);
  if (!config) throw new Error('LANGFUSE_SMOKE_CONFIGURATION_INVALID');
  const runtime = await runtimeFactory(config);
  const start = new Date(Date.now() - 60000).toISOString();
  try {
    const generation = runtime.start({ model: 'synthetic-no-charge',
      metadata: { synthetic: true, operation: 'deployment-smoke', provider: 'none' } });
    const traceId = generation.traceId;
    const observationId = generation.id;
    generation.update({ usageDetails: { input: 0, output: 0 } });
    generation.end();
    await runtime.flush();
    const url = new URL('/api/public/v2/observations', config.baseUrl);
    url.searchParams.set('traceId', traceId);
    url.searchParams.set('fromStartTime', start);
    url.searchParams.set('toStartTime', new Date(Date.now() + 60000).toISOString());
    url.searchParams.set('fields', 'core,basic,io');
    url.searchParams.set('limit', '1');
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt) await pause(5000);
      const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}` } });
      if (!response.ok) throw new Error(`LANGFUSE_SMOKE_READ_HTTP_${response.status}`);
      const body = await response.json();
      const found = body.data?.find(row => row.id === observationId && row.traceId === traceId);
      if (!found) continue;
      if ((found.input != null && found.input !== '') || (found.output != null && found.output !== '')) {
        throw new Error('LANGFUSE_SMOKE_UNEXPECTED_CONTENT');
      }
      return { status: 'verified', traceId, observationId, contentAbsent: true, paidAiCalls: 0 };
    }
    throw new Error('LANGFUSE_SMOKE_NOT_VISIBLE_YET');
  } finally { await runtime.shutdown(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runPreviewSmoke();
    console.log('LANGFUSE_PREVIEW_SMOKE', JSON.stringify(result));
  } catch (error) {
    // No raw transport errors, response bodies or configuration values in build logs.
    console.error(/^LANGFUSE_SMOKE_[A-Z_0-9]+$/.test(error.message) ? error.message : 'LANGFUSE_SMOKE_TRANSPORT_FAILED');
    process.exitCode = 1;
  }
}
