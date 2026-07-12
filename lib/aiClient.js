import { runTask, TASK_TYPES } from "./modelRouter.js";
import { getProvider } from "./providers/index.js";

function resolveModelId(m) {
  const provider = getProvider();
  return provider.resolveModelId(m);
}

export async function runTextAnalysis({ systemPrompt, userPrompt, model, fallbackModel, reasoningEffort }) {
  const result = await runTask(TASK_TYPES.PATIENT_DIALOG, {
    systemPrompt,
    userPrompt,
    model: resolveModelId(model),
    fallbackModel: resolveModelId(fallbackModel),
    reasoningEffort,
  });

  return {
    raw: result.raw,
    parsed: result.parsed,
    model_used: result.model_used,
    fallback_used: result.fallback_used,
  };
}
