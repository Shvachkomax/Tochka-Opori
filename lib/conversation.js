/**
 * Normalize conversation history from any storage format
 * into a uniform array of {role, text} objects.
 *
 * Supported input formats (in the array or nested):
 *   {role, content: string}
 *   {role: "assistant", questions: [string, ...]}
 *   {role: "user", answers: {key: string, ...}}
 *   {speaker, text}
 *   {question, answer}
 *   plain strings
 *   {role, content: [{text, ...}, ...]}
 *
 * If the provided history array is empty or absent, the function
 * tries to reconstruct from session fallback fields (patient_text,
 * questions[], answers{}). Old entries that carry neither role
 * nor text are silently skipped — no "---" placeholders.
 *
 * @param {Array|string} raw  Conversation history array (or JSON string)
 * @param {Object} [json]     Full session data for fallback fields
 * @returns {Array<{role:"user"|"assistant", text:string}>}
 */
export function normalizeConversationHistory(raw, json) {
  let entries = raw;
  if (typeof raw === "string") {
    try {
      entries = JSON.parse(raw);
    } catch {
      entries = [];
    }
  }
  if (!Array.isArray(entries)) entries = [];

  const result = [];
  let round = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      if (typeof entry === "string" && entry.trim()) {
        result.push({ role: "assistant", text: entry, round: ++round });
      }
      continue;
    }

    const role = (entry.role || "").toLowerCase();
    const isAssistant = ["assistant", "model", "ai"].includes(role);
    const isUser = ["user", "patient", "human"].includes(role);

    // {role, content: string}
    if (typeof entry.content === "string" && entry.content.trim()) {
      result.push({
        role: isUser ? "user" : "assistant",
        text: entry.content,
        round: entry.round || ++round,
      });
      continue;
    }

    // {role, content: [{text, ...}]}
    if (Array.isArray(entry.content) && entry.content.length > 0) {
      const parts = entry.content
        .map((p) =>
          typeof p === "string" ? p : p?.text || p?.content || p?.value || ""
        )
        .filter(Boolean);
      if (parts.length > 0) {
        result.push({
          role: isUser ? "user" : "assistant",
          text: parts.join("\n"),
          round: entry.round || ++round,
        });
        continue;
      }
    }

    // {role: "assistant", questions: [...]}
    if (Array.isArray(entry.questions) && entry.questions.length > 0) {
      for (const q of entry.questions) {
        if (q && typeof q === "string" && q.trim()) {
          result.push({ role: "assistant", text: q, round: ++round });
        }
      }
      continue;
    }

    // {role: "user", answers: {key: val, ...}}
    if (entry.answers && typeof entry.answers === "object" && !Array.isArray(entry.answers)) {
      const keys = Object.keys(entry.answers);
      if (keys.length > 0) {
        for (const k of keys) {
          const val = entry.answers[k];
          const text =
            typeof val === "string"
              ? val
              : val?.text || val?.content || JSON.stringify(val);
          if (text && text.trim()) {
            result.push({ role: "user", text, round: ++round });
          }
        }
        continue;
      }
    }

    // {speaker, text}
    if (entry.speaker && entry.text) {
      const s = entry.speaker.toLowerCase();
      result.push({
        role: ["patient", "user", "human"].includes(s) ? "user" : "assistant",
        text: entry.text,
        round: entry.round || ++round,
      });
      continue;
    }

    // {question, answer}
    if (entry.question || entry.answer) {
      if (entry.question && typeof entry.question === "string" && entry.question.trim()) {
        result.push({ role: "assistant", text: entry.question, round: ++round });
      }
      if (entry.answer && typeof entry.answer === "string" && entry.answer.trim()) {
        result.push({ role: "user", text: entry.answer, round: ++round });
      }
      continue;
    }

    // generic fallback
    const text =
      entry.text || entry.message || entry.value || entry.transcript || "";
    if (text && typeof text === "string" && text.trim()) {
      result.push({
        role: isUser ? "user" : "assistant",
        text,
        round: entry.round || ++round,
      });
    }
  }

  // If still empty and json fallback data is available,
  // reconstruct from legacy questions[] + answers{} + patient_text
  if (result.length === 0 && json) {
    const qs = json.questions || json.questions || [];
    const ans = json.answers || json.answers || {};
    const pt = json.patient_text || json.patientText || json.patient_input || "";

    if (Array.isArray(qs) && qs.length > 0) {
      let r = 0;
      qs.forEach((q, i) => {
        if (q && typeof q === "string" && q.trim()) {
          result.push({ role: "assistant", text: q, round: ++r });
        }
        const ak = Object.keys(ans)[i];
        if (ak !== undefined) {
          const val = ans[ak];
          const aText =
            typeof val === "string" ? val : val?.text || val?.content || "";
          if (aText && aText.trim()) {
            result.push({ role: "user", text: aText, round: r });
          }
        }
      });
    }

    // If only patient_text exists with no questions, show it
    if (result.length === 0 && pt && typeof pt === "string" && pt.trim()) {
      result.push({ role: "user", text: pt });
      result.push({
        role: "assistant",
        text: "Текст этой реплики не был сохранён",
      });
    }
  }

  return result;
}
