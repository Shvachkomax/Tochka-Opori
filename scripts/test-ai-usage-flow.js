import assert from 'node:assert/strict';
import { runTask, TASK_TYPES } from '../lib/modelRouter.js';
import { registerProvider } from '../lib/providers/index.js';

let attempt = 0;
registerProvider({
  name: 'openai', resolveModelId: name => name,
  isProviderError: error => error.code === 'rate_limit_exceeded',
  runCompletion: async payload => {
    attempt++;
    assert.equal(payload.telemetryTaskType, TASK_TYPES.PATIENT_DIALOG);
    if (attempt === 1) throw Object.assign(new Error('synthetic retry'), { code: 'rate_limit_exceeded' });
    return { raw: '{}', parsed: {}, input_tokens: 20, output_tokens: 0, total_tokens: 20,
      cached_input_tokens: 5, reasoning_tokens: 0 };
  },
});
const result = await runTask(TASK_TYPES.PATIENT_DIALOG, { systemPrompt: 'synthetic', userPrompt: 'synthetic', model: 'primary', fallbackModel: 'secondary' });
assert.equal(attempt, 2);
assert.equal(result.fallback_used, true);
assert.equal(result.input_tokens, 20);
assert.equal(result.output_tokens, 0);
assert.equal(result.cached_input_tokens, 5);
assert.equal(result.reasoning_tokens, 0);
console.log('AI router usage flow PASS: fallback preserves counts including zero.');
