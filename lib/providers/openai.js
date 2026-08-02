import { PROVIDER_MODEL_MAP, PROVIDERS, MODELS } from "../config/models.js";

export const name = PROVIDERS.OPENAI;

function isReasoningModel(model) {
  return model && (model.startsWith("gpt-5") || model.startsWith("o"));
}

function isModelError(err) {
  const modelErrors = new Set([
    "model_not_found",
    "insufficient_quota",
    "invalid_request_error",
    "invalid_response",
  ]);
  const unsupportedParamPattern =
    /unsupported|reasoning_effort|not supported|does not support|upstream|5\d\d|4\d\d/i;
  const errorType = err.code || err.type || "";
  const errorMsg = err.message || "";
  const status = Number(err.statusCode) || 0;
  return (
    modelErrors.has(errorType) ||
    unsupportedParamPattern.test(errorMsg) ||
    (status >= 400 && status < 500)
  );
}

function parseJSON(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw
      .replace(/```json\s*/g, "")
      .replace(/```/g, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

export function resolveModelId(logicalModel) {
  if (!logicalModel) return null;
  const map = PROVIDER_MODEL_MAP[PROVIDERS.OPENAI];
  if (map[logicalModel]) return map[logicalModel];
  if (Object.values(MODELS).includes(logicalModel)) return logicalModel;
  return logicalModel;
}

async function callResponsesAPI({ systemPrompt, userPrompt, model, reasoningEffort, images }) {
  const t0 = Date.now();
  const maxOutputTokens = parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || "4096", 10) || 4096;

  const userContent = [];
  if (userPrompt) userContent.push({ type: "input_text", text: userPrompt });
  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === "string" && img.startsWith("data:image/")) {
        userContent.push({ type: "input_image", image_url: img });
      }
    }
  }

  const body = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent.length === 1 && userContent[0].type === "input_text" ? userPrompt : userContent },
    ],
    reasoning: { effort: reasoningEffort || "medium" },
    max_output_tokens: maxOutputTokens,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    const err = new Error(
      `Responses API returned non-JSON (HTTP ${response.status}): ${responseText.slice(0, 200)}`,
    );
    err.code = "invalid_response";
    err.type = "server_error";
    err.statusCode = response.status;
    throw err;
  }

  if (!response.ok || data.error) {
    const err = new Error(data.error?.message || "Responses API error");
    err.code = data.error?.code || data.error?.type || "responses_api_error";
    err.type = data.error?.type || "";
    err.statusCode = response.status;
    throw err;
  }

  let text = "";
  if (data.output_text) {
    text = data.output_text;
  } else if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === "output_text") {
            text += c.text;
          }
        }
      }
    }
  }

  const parsed = parseJSON(text);
  const elapsed = Date.now() - t0;
  console.log(JSON.stringify({
    api: "responses",
    model,
    status: response.status,
    incomplete_reason: data.incomplete_details?.reason || null,
    input_tokens: data.usage?.input_tokens || null,
    output_tokens: data.usage?.output_tokens || null,
    reasoning_tokens: data.usage?.output_tokens_details?.reasoning_tokens || null,
    output_text_chars: text.length,
    json_parse_ok: parsed !== null,
    elapsed_ms: elapsed,
  }));

  return { raw: text, parsed };
}

async function callChatCompletions({ systemPrompt, userPrompt, model, reasoningEffort, images }) {
  const t0 = Date.now();
  const maxTokens = parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || "4096", 10) || 4096;

  const userContent = [];
  if (userPrompt) userContent.push({ type: "text", text: userPrompt });
  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === "string" && img.startsWith("data:image/")) {
        userContent.push({ type: "image_url", image_url: { url: img } });
      }
    }
  }

  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent.length === 1 && userContent[0].type === "text" ? userPrompt : userContent },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
  };

  if (reasoningEffort && !model.includes("mini")) {
    body.reasoning_effort = reasoningEffort;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    const err = new Error(
      `Chat Completions API returned non-JSON (HTTP ${response.status}): ${responseText.slice(0, 200)}`,
    );
    err.code = "invalid_response";
    err.type = "server_error";
    err.statusCode = response.status;
    throw err;
  }

  if (!response.ok || data.error) {
    const err = new Error(data.error?.message || "Chat Completions API error");
    err.code = data.error?.code || data.error?.type || "";
    err.type = data.error?.type || "";
    err.statusCode = response.status;
    throw err;
  }

  const raw = data.choices?.[0]?.message?.content?.trim() || "";
  const parsed = parseJSON(raw);
  const choice = data.choices?.[0];
  const usage = data.usage || {};
  const elapsed = Date.now() - t0;
  console.log(JSON.stringify({
    api: "chat_completions",
    model,
    status: response.status,
    finish_reason: choice?.finish_reason || null,
    prompt_tokens: usage.prompt_tokens || null,
    completion_tokens: usage.completion_tokens || null,
    output_text_chars: raw.length,
    json_parse_ok: parsed !== null,
    elapsed_ms: elapsed,
  }));

  return { raw, parsed };
}

export async function runCompletion({
  systemPrompt,
  userPrompt,
  model,
  reasoningEffort,
  images,
}) {
  const useResponsesApi = process.env.AI_USE_RESPONSES_API === "true";
  const isRA = isReasoningModel(model);

  console.log("Model call:", {
    model,
    useResponsesApi: isRA ? useResponsesApi : false,
    reasoningEffort: isRA ? reasoningEffort : "none",
    hasImages: Array.isArray(images) && images.length > 0,
  });

  if (isRA && useResponsesApi) {
    return callResponsesAPI({ systemPrompt, userPrompt, model, reasoningEffort, images });
  }

  return callChatCompletions({
    systemPrompt,
    userPrompt,
    model,
    reasoningEffort: isRA ? reasoningEffort : void 0,
    images,
  });
}

export async function transcribeAudio(audioBuffer, contentType) {
  const formData = new FormData();
  const audioBlob = new Blob([audioBuffer], {
    type: contentType || "audio/webm",
  });

  const modelId =
    PROVIDER_MODEL_MAP[PROVIDERS.OPENAI].TRANSCRIPTION;

  formData.append("file", audioBlob, "voice.webm");
  formData.append("model", modelId);
  formData.append("language", "ru");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    const err = new Error(
      `Transcription API returned non-JSON (HTTP ${response.status}): ${responseText.slice(0, 300)}`,
    );
    err.code = "invalid_response";
    err.type = "transcription_error";
    err.statusCode = response.status;
    throw err;
  }

  if (!response.ok || data.error) {
    const err = new Error(data.error?.message || "Transcription failed");
    err.code = "transcription_error";
    err.statusCode = response.status;
    throw err;
  }

  return { text: data.text || "" };
}

export async function analyzeVoice(audioBuffer, audioFormat) {
  const modelId =
    PROVIDER_MODEL_MAP[PROVIDERS.OPENAI].VOICE_ANALYSIS;
  if (!modelId) return null;

  const audioBase64 = audioBuffer.toString("base64");

  const promptPaths = [
    new URL("../../prompts/support/voice-analysis.md", import.meta.url),
    new URL("../../prompts/voice-analysis.md", import.meta.url),
  ];
  let voiceSystemPrompt =
    "Ты анализируешь голосовое сообщение и возвращаешь JSON.";
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    for (const pp of promptPaths) {
      if (existsSync(pp)) {
        voiceSystemPrompt = readFileSync(pp, "utf-8");
        break;
      }
    }
  } catch {}

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: audioBase64,
                format: audioFormat,
              },
            },
            {
              type: "text",
              text: voiceSystemPrompt,
            },
          ],
        },
      ],
      temperature: 0.3,
    }),
  });

  const voiceText = await res.text();
  let voiceData;
  try {
    voiceData = JSON.parse(voiceText);
  } catch {
    return { status: "error", experimental: true, error_code: "voice_analysis_invalid_response" };
  }

  if (!res.ok || voiceData?.error) {
    return { status: "error", experimental: true, error_code: "voice_analysis_failed" };
  }

  const content = voiceData.choices?.[0]?.message?.content || "";
  try {
    const observations = JSON.parse(content);
    observations.experimental = true;
    return observations;
  } catch {
    return { status: "error", experimental: true, error_code: "voice_analysis_invalid_response" };
  }
}

export function isProviderError(err) {
  return isModelError(err);
}
