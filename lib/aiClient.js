function isReasoningModel(model) {
  return model && (model.startsWith("gpt-5") || model.startsWith("o"));
}

function isModelError(err) {
  const modelErrors = new Set(["model_not_found", "insufficient_quota", "invalid_request_error", "invalid_response"]);
  const unsupportedParamPattern = /unsupported|reasoning_effort|not supported|does not support|upstream|5\d\d|4\d\d/i;
  const errorType = err.code || err.type || "";
  const errorMsg = err.message || "";
  const status = Number(err.statusCode) || 0;
  return modelErrors.has(errorType) || unsupportedParamPattern.test(errorMsg) || (status >= 400 && status < 500);
}

function parseJSON(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

async function callResponsesAPI({ systemPrompt, userPrompt, model, reasoningEffort }) {
  const body = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    reasoning: { effort: reasoningEffort || "medium" },
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
    const err = new Error(`Responses API returned non-JSON (HTTP ${response.status}): ${responseText.slice(0, 200)}`);
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

  return { raw: text, parsed: parseJSON(text) };
}

async function callChatCompletions({ systemPrompt, userPrompt, model, reasoningEffort }) {
  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
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
    const err = new Error(`Chat Completions API returned non-JSON (HTTP ${response.status}): ${responseText.slice(0, 200)}`);
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

  return { raw, parsed: parseJSON(raw) };
}

export async function runTextAnalysis({ systemPrompt, userPrompt, model, fallbackModel, reasoningEffort }) {
  const useResponsesApi = process.env.AI_USE_RESPONSES_API === "true";
  const isRA = isReasoningModel(model);

  console.log("Analyze model config:", {
    model,
    fallbackModel,
    useResponsesApi: isRA ? useResponsesApi : false,
    reasoningEffort: isRA ? reasoningEffort : "none",
    hasTextOnlyInput: true,
  });

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const currentModel = attempt === 0 ? model : fallbackModel;
    const useRAForThis = attempt === 0 && isRA && useResponsesApi;

    try {
      let result;
      if (useRAForThis) {
        result = await callResponsesAPI({
          systemPrompt,
          userPrompt,
          model: currentModel,
          reasoningEffort,
        });
      } else {
        result = await callChatCompletions({
          systemPrompt,
          userPrompt,
          model: currentModel,
          reasoningEffort: attempt === 0 && isRA ? reasoningEffort : undefined,
        });
      }

      return {
        raw: result.raw,
        parsed: result.parsed,
        model_used: currentModel,
        fallback_used: attempt > 0,
      };
    } catch (err) {
      if (attempt === 0 && isModelError(err)) {
        console.log(`Model ${currentModel} failed (${err.code || err.type}: ${err.message}), falling back to ${fallbackModel}`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("All AI attempts failed");
}
