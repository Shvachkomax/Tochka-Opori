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

// ─── Report extraction helpers ──────────────────────────────────

function extractReportFromAiResult(aiResult, reportType) {
  if (!aiResult) return "";
  const targetField = reportType === "user_report" ? "user_report" : "doctor_report";
  const altField = reportType === "user_report" ? "patient_report" : "specialist_report";

  // Object
  if (typeof aiResult === "object" && !Array.isArray(aiResult)) {
    return aiResult[targetField] || aiResult[altField] || "";
  }

  // JSON string
  if (typeof aiResult === "string") {
    try {
      const parsed = JSON.parse(aiResult);
      if (parsed && typeof parsed === "object") {
        return parsed[targetField] || parsed[altField] || "";
      }
    } catch { /* not JSON — try delimiters */ }

    // Delimited report format: "===USER_REPORT===\n\n...\n\n===DOCTOR_REPORT===\n\n..."
    const marker = reportType === "user_report" ? "===USER_REPORT===" : "===DOCTOR_REPORT===";
    const nextMarker = reportType === "user_report" ? "===DOCTOR_REPORT===" : null;

    if (aiResult.includes(marker)) {
      const parts = aiResult.split(marker);
      if (parts.length > 1) {
        let text = parts[1].trim();
        if (nextMarker && text.includes(nextMarker)) {
          text = text.split(nextMarker)[0].trim();
        }
        return text;
      }
    }
  }

  return "";
}

/**
 * Search every known location for user-facing report text.
 * @param {Object} review - The case_review row (top-level columns)
 * @param {Object} j      - json_data from the review (or the whole session blob)
 * @returns {string} The extracted report text, or "" if not found.
 */
export function extractUserReport(review, j) {
  const j_ = j || {};
  const r = review || {};

  // 1. review top-level columns
  if (r.user_report) return r.user_report;
  if (r.patient_report) return r.patient_report;

  // 2. json_data fields
  if (j_.user_report) return j_.user_report;
  if (j_.patient_report) return j_.patient_report;

  // 3. nested inside json_data.result / json_data.report
  if (j_.result?.user_report) return j_.result.user_report;
  if (j_.result?.patient_report) return j_.result.patient_report;
  if (j_.report?.user_report) return j_.report.user_report;
  if (j_.report?.patient_report) return j_.report.patient_report;

  // 4. inside json_data.session
  if (j_.session?.user_report) return j_.session.user_report;
  if (j_.session?.patient_report) return j_.session.patient_report;

  // 5. final_report / analysis
  if (j_.final_report) return j_.final_report;
  if (j_.analysis?.user_report) return j_.analysis.user_report;

  // 6. ai_result — JSON object or delimited string
  const fromAi = extractReportFromAiResult(j_.ai_result, "user_report");
  if (fromAi) return fromAi;

  // 7. legacy: raw report field
  if (j_.report && typeof j_.report === "string") return j_.report;

  return "";
}

/**
 * Search every known location for specialist-facing report text.
 */
export function extractDoctorReport(review, j) {
  const j_ = j || {};
  const r = review || {};

  if (r.doctor_report) return r.doctor_report;
  if (r.specialist_report) return r.specialist_report;

  if (j_.doctor_report) return j_.doctor_report;
  if (j_.specialist_report) return j_.specialist_report;

  if (j_.result?.doctor_report) return j_.result.doctor_report;
  if (j_.result?.specialist_report) return j_.result.specialist_report;
  if (j_.report?.doctor_report) return j_.report.doctor_report;
  if (j_.report?.specialist_report) return j_.report.specialist_report;

  if (j_.session?.doctor_report) return j_.session.doctor_report;
  if (j_.session?.specialist_report) return j_.session.specialist_report;

  if (j_.analysis?.doctor_report) return j_.analysis.doctor_report;

  const fromAi = extractReportFromAiResult(j_.ai_result, "doctor_report");
  if (fromAi) return fromAi;

  return "";
}

/**
 * Search every known location for expert / doctor feedback.
 * Returns an object keyed by field name.
 */
export function extractExpertFeedback(review, j) {
  const j_ = j || {};
  const r = review || {};

  const feedback = r.doctor_feedback || r.expert_feedback || r.feedback ||
                   j_.doctor_feedback || j_.expert_feedback || j_.feedback ||
                   {};

  if (typeof feedback === "object" && !Array.isArray(feedback)) {
    return {
      wrongQuestions: feedback.wrong_questions || feedback.wrongQuestions || "",
      missingQuestions: feedback.missing_questions || feedback.missingQuestions || "",
      badQuestionWording: feedback.bad_question_wording || feedback.badQuestionWording || "",
      correctedUserReport: feedback.corrected_user_report || feedback.correctedUserReport || "",
      correctedDoctorReport: feedback.corrected_doctor_report || feedback.correctedDoctorReport || "",
      protocolUpdate: feedback.protocol_update || feedback.protocolUpdate || "",
      correctionComment: feedback.correction_comment || feedback.correctionComment || r.correction_comment || "",
      generalComment: feedback.general_comment || feedback.generalComment || "",
    };
  }

  return {};
}

/**
 * Normalize all session details for display.
 * Returns { patientText, conversationHistory, userReport, doctorReport, doctorFeedback }.
 */
export function normalizeSessionDetails(review) {
  const json = (review?.json_data);
  const j = (json && typeof json === "object" && !Array.isArray(json)) ? json :
            (typeof json === "string" ? (() => { try { return JSON.parse(json); } catch { return {}; } })() : {});

  let r = review || {};

  // Patient text
  const patientText =
    r.patient_text || r.text || r.input_text ||
    j.patient_text || j.text || j.input_text || j.original_text ||
    j.patient_input || j.input ||
    j.session?.initial_text || j.session?.patient_text ||
    "";

  // Conversation history
  const rawHistory =
    j.conversation_history || j.conversationHistory ||
    r.conversation_history || r.conversationHistory ||
    j.session?.conversation_history || j.session?.conversationHistory ||
    [];

  const conversationHistory = normalizeConversationHistory(rawHistory, j);

  // Reports
  const userReport = extractUserReport(r, j);
  const doctorReport = extractDoctorReport(r, j);

  // Doctor feedback
  const doctorFeedback = extractExpertFeedback(r, j);

  return { patientText, conversationHistory, userReport, doctorReport, doctorFeedback };
}
