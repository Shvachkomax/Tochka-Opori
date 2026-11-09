import assert from 'node:assert/strict';
import { runTask, setProvider, TASK_TYPES } from '../lib/modelRouter.js';

setProvider('openai');
const fetchBefore = globalThis.fetch;
process.env.AI_TELEMETRY_ENABLED = 'false'; // No external exports from this isolated test.
let responses = false;
let failFirst = false;
let requests = 0;
globalThis.fetch = async url => {
  assert.equal(String(url).startsWith('https://api.openai.com/v1/'), true);
  requests++;
  if (failFirst) {
    failFirst = false;
    return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'synthetic retry' } }), { status: 429 });
  }
  const body = responses
    ? { model: 'gpt-5.5', output_text: '{}', usage: { input_tokens: 8, output_tokens: 0, total_tokens: 8, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 0 } } }
    : { model: 'gpt-4.1-mini', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } } };
  return new Response(JSON.stringify(body), { status: 200 });
};
try {
  process.env.AI_USE_RESPONSES_API = 'false';
  const chat = await runTask(TASK_TYPES.PATIENT_DIALOG, { model: 'gpt-4.1-mini', fallbackModel: null, systemPrompt: 'synthetic', userPrompt: 'synthetic' });
  assert.equal(chat.input_tokens, 10);
  assert.equal(chat.output_tokens, 4);
  assert.equal(chat.cached_input_tokens, 2);
  assert.equal(chat.reasoning_tokens, 1);
  assert.equal(chat.total_tokens, 14);
  process.env.AI_USE_RESPONSES_API = 'true';
  responses = true;
  const response = await runTask(TASK_TYPES.PATIENT_DIALOG, { model: 'gpt-5.5', fallbackModel: null, systemPrompt: 'synthetic', userPrompt: 'synthetic' });
  assert.equal(response.input_tokens, 8);
  assert.equal(response.output_tokens, 0);
  assert.equal(response.cached_input_tokens, 3);
  assert.equal(response.reasoning_tokens, 0);
  responses = false;
  process.env.AI_USE_RESPONSES_API = 'false';
  failFirst = true;
  const retried = await runTask(TASK_TYPES.PATIENT_DIALOG, { model: 'gpt-5.5', fallbackModel: 'gpt-4.1-mini', systemPrompt: 'synthetic', userPrompt: 'synthetic' });
  assert.equal(retried.fallback_used, true);
  assert.equal(retried.input_tokens, 10);
  assert.equal(requests, 4);
} finally { globalThis.fetch = fetchBefore; }
console.log('OpenAI provider → router usage PASS: Chat, Responses, cached/reasoning counts, zero and fallback; mocked network only.');
