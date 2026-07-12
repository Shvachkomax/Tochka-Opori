import {
  TASK_MODEL_MAP,
  TASK_TYPES,
  DEFAULT_PROVIDER,
  ROUTER_VERSION,
} from "./config/models.js";
import { getProvider, getSupportedProviders } from "./providers/index.js";

let activeProvider = DEFAULT_PROVIDER;

export function setProvider(name) {
  getProvider(name);
  activeProvider = name;
  console.log(`Model router: provider set to "${name}"`);
}

export function getActiveProvider() {
  return activeProvider;
}

export async function runTask(taskType, payload = {}) {
  const taskConfig = TASK_MODEL_MAP[taskType];
  if (!taskConfig) {
    throw new Error(
      `Model router: unknown task type "${taskType}". Available: ${Object.keys(TASK_MODEL_MAP).join(", ")}`,
    );
  }

  const {
    systemPrompt,
    userPrompt,
    model: explicitModel,
    fallbackModel: explicitFallback,
    reasoningEffort: explicitEffort,
    ...rest
  } = payload;

  const logicalModel = explicitModel || taskConfig.model;
  const logicalFallback = explicitFallback ?? taskConfig.fallbackModel;
  const reasoningEffort = explicitEffort ?? taskConfig.reasoningEffort;

  const provider = getProvider(activeProvider);
  const actualModelId = provider.resolveModelId(logicalModel);

  const startTime = Date.now();

  console.log("Model router runTask:", {
    taskType,
    logicalModel,
    actualModelId,
    provider: activeProvider,
    fallbackModel: logicalFallback,
  });

  let lastError = null;
  let fallbackUsed = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const currentLogical =
      attempt === 0 ? logicalModel : logicalFallback;
    if (attempt === 1 && !currentLogical) break;
    if (attempt === 1 && currentLogical === logicalModel) break;

    const currentModelId = provider.resolveModelId(currentLogical);

    try {
      const result = await provider.runCompletion({
        systemPrompt,
        userPrompt,
        model: currentModelId,
        reasoningEffort:
          attempt === 0 ? reasoningEffort : void 0,
        ...rest,
      });

      const duration = Date.now() - startTime;
      const taskMetadata = {
        provider: activeProvider,
        model: currentModelId,
        logicalModel: currentLogical,
        taskType,
        routerVersion: ROUTER_VERSION,
        requestDuration: duration,
        fallbackUsed,
        fallbackReason: fallbackUsed ? (lastError?.message || "unknown") : void 0,
      };

      return {
        raw: result.raw,
        parsed: result.parsed,
        model_used: currentModelId,
        provider: activeProvider,
        task_type: taskType,
        router_version: ROUTER_VERSION,
        request_duration: duration,
        fallback_used: fallbackUsed,
        ...taskMetadata,
      };
    } catch (err) {
      if (attempt === 0 && provider.isProviderError(err)) {
        console.log(
          `Model ${currentModelId} failed (${err.code || err.type}: ${err.message}), falling back to ${logicalFallback}`,
        );
        lastError = err;
        fallbackUsed = true;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Model router: all attempts failed");
}

export async function transcribe(taskType, payload = {}) {
  const taskConfig = TASK_MODEL_MAP[taskType];
  if (!taskConfig) {
    throw new Error(
      `Model router: unknown task type "${taskType}" for transcription`,
    );
  }

  const { audioBuffer, contentType, ...rest } = payload;
  const provider = getProvider(activeProvider);

  const startTime = Date.now();

  if (!provider.transcribeAudio) {
    throw new Error(
      `Provider "${activeProvider}" does not support transcription`,
    );
  }

  const result = await provider.transcribeAudio(audioBuffer, contentType);

  const duration = Date.now() - startTime;

  return {
    text: result.text,
    provider: activeProvider,
    task_type: taskType,
    router_version: ROUTER_VERSION,
    request_duration: duration,
  };
}

export async function analyzeVoice(taskType, payload = {}) {
  const { audioBuffer, audioFormat } = payload;
  const provider = getProvider(activeProvider);

  if (!provider.analyzeVoice) return null;

  const startTime = Date.now();
  const result = await provider.analyzeVoice(audioBuffer, audioFormat);

  return {
    ...result,
    provider: activeProvider,
    task_type: taskType,
    router_version: ROUTER_VERSION,
    request_duration: Date.now() - startTime,
  };
}

export function getTaskModelConfig(taskType) {
  const taskConfig = TASK_MODEL_MAP[taskType];
  if (!taskConfig) return null;
  const provider = getProvider(activeProvider);
  return {
    logicalModel: taskConfig.model,
    actualModelId: provider.resolveModelId(taskConfig.model),
    logicalFallback: taskConfig.fallbackModel,
    actualFallbackId: taskConfig.fallbackModel
      ? provider.resolveModelId(taskConfig.fallbackModel)
      : null,
    provider: activeProvider,
  };
}

export { TASK_TYPES };
