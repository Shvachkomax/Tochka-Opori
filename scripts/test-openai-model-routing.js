import assert from "node:assert/strict";

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(init.body));
  const responseBody = requests.at(-1).input
    ? { output_text: "{}", usage: {} }
    : { choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} };
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

process.env.OPENAI_MAX_OUTPUT_TOKENS = "4096";
process.env.AI_USE_RESPONSES_API = "false";
const { runCompletion } = await import("../lib/providers/openai.js");

await runCompletion({ systemPrompt: "system", userPrompt: "reasoning", model: "gpt-5.5", reasoningEffort: "medium" });
const reasoningChatBody = requests.at(-1);
assert.equal(reasoningChatBody.max_completion_tokens, 4096);
assert.equal("max_tokens" in reasoningChatBody, false);
assert.equal("temperature" in reasoningChatBody, false);

await runCompletion({ systemPrompt: "system", userPrompt: "ordinary", model: "gpt-4.1-mini" });
const ordinaryChatBody = requests.at(-1);
assert.equal(ordinaryChatBody.max_tokens, 4096);
assert.equal("max_completion_tokens" in ordinaryChatBody, false);
assert.equal(ordinaryChatBody.temperature, 0.3);

process.env.AI_USE_RESPONSES_API = "true";
await runCompletion({ systemPrompt: "system", userPrompt: "responses", model: "gpt-5.5", reasoningEffort: "medium" });
const responsesBody = requests.at(-1);
assert.equal(responsesBody.max_output_tokens, 4096);
assert.equal("max_tokens" in responsesBody, false);
assert.equal("max_completion_tokens" in responsesBody, false);

globalThis.fetch = originalFetch;
console.log("OpenAI model routing parameter tests passed.");
