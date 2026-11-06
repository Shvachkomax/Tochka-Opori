// Keep provider totals distinct from their subsets; missing usage is not zero.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function normalizeOpenAiUsage(usage, api) {
  const responses = api === 'responses';
  const input = count(responses ? usage?.input_tokens : usage?.prompt_tokens);
  const output = count(responses ? usage?.output_tokens : usage?.completion_tokens);
  const inputDetails = responses ? usage?.input_tokens_details : usage?.prompt_tokens_details;
  const outputDetails = responses ? usage?.output_tokens_details : usage?.completion_tokens_details;
  const cached = count(inputDetails?.cached_tokens);
  const reasoning = count(outputDetails?.reasoning_tokens);
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: count(usage?.total_tokens),
    cached_input_tokens: cached != null && input != null && cached <= input ? cached : null,
    reasoning_tokens: reasoning != null && output != null && reasoning <= output ? reasoning : null,
  };
}

export function langfuseUsage(result) {
  const usage = {};
  const input = count(result?.input_tokens);
  const output = count(result?.output_tokens);
  const cached = count(result?.cached_input_tokens);
  if (input != null) {
    if (cached != null && cached <= input) {
      usage.input = input - cached;
      usage.input_cached_tokens = cached;
    } else usage.input = input;
  }
  // Reasoning is already included in output: never add it again.
  if (output != null) usage.output = output;
  return usage;
}
