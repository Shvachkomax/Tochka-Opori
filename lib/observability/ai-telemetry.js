import { randomUUID } from 'node:crypto';
import { TASK_TYPES } from '../config/models.js';
import { langfuseUsage } from './usage.js';

const TASKS = new Set(Object.values(TASK_TYPES));
const SAFE_ERRORS = new Set(['invalid_response', 'invalid_request_error', 'model_not_found',
  'insufficient_quota', 'rate_limit_exceeded', 'context_length_exceeded', 'server_error']);
const modelName = value => typeof value === 'string' && /^[a-zA-Z0-9._:/-]{1,100}$/.test(value) ? value : 'unknown';

export function telemetryConfiguration(env) {
  if (env.AI_TELEMETRY_ENABLED !== 'true' || env.DEPLOYMENT_PURPOSE !== 'test' || env.VERCEL_ENV === 'production') return null;
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY || !env.LANGFUSE_BASE_URL) return null;
  let url;
  try { url = new URL(env.LANGFUSE_BASE_URL); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  return { publicKey: env.LANGFUSE_PUBLIC_KEY, secretKey: env.LANGFUSE_SECRET_KEY, baseUrl: url.origin };
}

export async function createLangfuseRuntime(config, { exporter } = {}) {
  // No auto-instrumentation or global tracer registration: prompts, HTTP headers,
  // database calls and application request bodies are never captured.
  process.env.LANGFUSE_LOG_LEVEL = 'NONE';
  process.env.LANGFUSE_DEBUG = 'false';
  const [{ NodeTracerProvider, AlwaysOnSampler }, { LangfuseSpanProcessor }, tracing, { context, ROOT_CONTEXT }] = await Promise.all([
    import('@opentelemetry/sdk-trace-node'), import('@langfuse/otel'),
    import('@langfuse/tracing'), import('@opentelemetry/api'),
  ]);
  const processor = new LangfuseSpanProcessor({
    ...config, environment: 'test', timeout: 1, exportMode: 'immediate', mediaUploadEnabled: false,
    ...(exporter ? { exporter } : {}),
    shouldExportSpan: ({ otelSpan }) => otelSpan.name === 'ai.provider-request' && otelSpan.instrumentationScope.name === 'langfuse-sdk',
  });
  const provider = new NodeTracerProvider({ sampler: new AlwaysOnSampler(), spanProcessors: [processor] });
  tracing.setLangfuseTracerProvider(provider);
  return {
    start: attributes => context.with(ROOT_CONTEXT, () => tracing.startObservation('ai.provider-request', attributes, { asType: 'generation' })),
    flush: () => processor.forceFlush(),
    shutdown: async () => { await provider.shutdown(); tracing.setLangfuseTracerProvider(null); },
  };
}

async function withTimeout(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('telemetry timeout')), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function boundedFlush(runtime) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => runtime.flush()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('flush timeout')), 1500); }),
    ]);
  } catch {
    console.warn('[ai-telemetry] EXPORT_FAILED');
  } finally { clearTimeout(timer); }
}

// Dependency injection exercises the real provider path without cloud keys or paid calls.
export function createAiTelemetry({ env = process.env, loadSdk = createLangfuseRuntime } = {}) {
  let runtimePromise;
  return async function observeCompletion({ model, taskType }, perform) {
    const config = telemetryConfiguration(env);
    if (!config) return perform();
    let runtime;
    let generation;
    try {
      runtimePromise ??= loadSdk(config);
      runtime = await withTimeout(() => runtimePromise, 1000);
      generation = runtime.start({
        model: modelName(model),
        metadata: { call_id: randomUUID(), provider: 'openai', operation: 'completion',
          task_type: TASKS.has(taskType) ? taskType : 'completion' },
      });
    } catch {
      runtimePromise = null;
      console.warn('[ai-telemetry] INIT_FAILED');
    }
    try {
      const result = await perform();
      if (generation) {
        try {
          const usage = langfuseUsage(result);
          generation.update({ model: modelName(result.model_used || model), usageDetails: usage,
            metadata: { usage_missing: Object.keys(usage).length === 0,
              ...(Number.isSafeInteger(result.reasoning_tokens) && result.reasoning_tokens >= 0
                ? { reasoning_tokens: result.reasoning_tokens } : {}) } });
        } catch { console.warn('[ai-telemetry] UPDATE_FAILED'); }
      }
      return result;
    } catch (error) {
      if (generation) {
        try {
          // Never export exception messages, stacks, request/response bodies or raw codes.
          generation.update({ level: 'ERROR', statusMessage: SAFE_ERRORS.has(error?.code) ? error.code : 'provider_request_failed' });
        } catch { console.warn('[ai-telemetry] UPDATE_FAILED'); }
      }
      throw error;
    } finally {
      if (generation) {
        try { generation.end(); } catch { console.warn('[ai-telemetry] END_FAILED'); }
      }
      if (runtime) await boundedFlush(runtime);
    }
  };
}

export const observeCompletion = createAiTelemetry();
