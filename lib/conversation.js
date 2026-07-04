/**
 * Normalize conversation history from any storage format
 * into a structured array of {round, question, answer} pairs.
 *
 * ── Algorithm ──────────────────────────────────────────────
 * 1. Walk conversationHistory entries in sequential pairs
 *    (assistant questions[] → user answers{}).
 * 2. Within each pair, match questions[i] with answers[i]
 *    by array index (or questionId / index / sequence when present).
 * 3. Unpaired assistant entries → answer = "Ответ не был сохранён".
 * 4. Legacy fallback: top-level questions[] + answers{} paired by index.
 * 5. Other formats ({question, answer}, {speaker, text}, etc.)
 *    are converted to one-sided or full pairs as appropriate.
 * 6. Number rounds sequentially (1-based) over the resulting pairs.
 * 7. Patient text (if available) is returned separately as patientText.
 *
 * @param {Array|string} raw  Conversation history array (or JSON string)
 * @param {Object} [json]     Full session data (for patient_text, fallback questions/answers)
 * @returns {{ rounds: Array<{round:number, question:string, answer:string}>, patientText: string }}
 */
export function normalizeConversationHistory(raw, json) {
  let entries = raw;
  if (typeof raw === "string") {
    try { entries = JSON.parse(raw); } catch { entries = []; }
  }
  if (!Array.isArray(entries)) entries = [];

  // ── Idempotency: already in rounds format ──
  if (entries.length > 0 && typeof entries[0] === "object" && "round" in entries[0] && "question" in entries[0]) {
    const pt = extractPatientText(json);
    return { rounds: entries, patientText: pt };
  }

  const patientText = extractPatientText(json);
  const pairs = []; // each: { question: string, answer: string|null }

  // ── 1. Walk entries, pairing assistant→user by index ──
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object") {
      if (typeof entry === "string" && entry.trim()) {
        pairs.push({ question: entry, answer: null });
      }
      i++;
      continue;
    }

    const role = (entry.role || "").toLowerCase();
    const isAssistant = ["assistant", "model", "ai"].includes(role);
    const isUser = ["user", "patient", "human"].includes(role);
    const next = i + 1 < entries.length ? entries[i + 1] : null;

    // ── Paired: assistant (questions[]) → user (answers{}) ──
    if (isAssistant && Array.isArray(entry.questions) && entry.questions.length > 0) {
      const questions = entry.questions.filter((q) => q && typeof q === "string" && q.trim());
      if (questions.length > 0) {
        if (next) {
          const nr = (next.role || "").toLowerCase();
          const isNextUser = ["user", "patient", "human"].includes(nr);
          if (isNextUser && next.answers && typeof next.answers === "object" && !Array.isArray(next.answers)) {
            const ansKeys = Object.keys(next.answers);
            for (let j = 0; j < questions.length; j++) {
              const ak = ansKeys[j];
              pairs.push({
                question: questions[j],
                answer: ak !== undefined ? extractAnswerText(next.answers[ak]) : null,
              });
            }
            i += 2;
            continue;
          }
        }
        // Unpaired assistant questions
        for (const q of questions) {
          pairs.push({ question: q, answer: null });
        }
      }
      i++;
      continue;
    }

    // ── Standalone user entry with answers{} ──
    if (isUser && entry.answers && typeof entry.answers === "object" && !Array.isArray(entry.answers)) {
      const keys = Object.keys(entry.answers);
      for (const k of keys) {
        const aText = extractAnswerText(entry.answers[k]);
        if (aText && aText.trim()) {
          pairs.push({ question: null, answer: aText });
        }
      }
      i++;
      continue;
    }

    // ── {question, answer} direct pair ──
    if (entry.question !== undefined || entry.answer !== undefined) {
      const qText = typeof entry.question === "string" ? entry.question : (entry.question?.text || "");
      const aText = typeof entry.answer === "string" ? entry.answer : (entry.answer?.text || "");
      pairs.push({
        question: qText || null,
        answer: aText || null,
      });
      i++;
      continue;
    }

    // ── {role, content: string} ──
    if (typeof entry.content === "string" && entry.content.trim()) {
      if (isUser || role === "patient") {
        pairs.push({ question: null, answer: entry.content });
      } else {
        pairs.push({ question: entry.content, answer: null });
      }
      i++;
      continue;
    }

    // ── {role, content: [{text, ...}]} ──
    if (Array.isArray(entry.content) && entry.content.length > 0) {
      const parts = entry.content
        .map((p) => (typeof p === "string" ? p : p?.text || p?.content || p?.value || ""))
        .filter(Boolean);
      if (parts.length > 0) {
        const text = parts.join("\n");
        if (isUser || role === "patient") {
          pairs.push({ question: null, answer: text });
        } else {
          pairs.push({ question: text, answer: null });
        }
      }
      i++;
      continue;
    }

    // ── {speaker, text} ──
    if (entry.speaker && entry.text) {
      const s = entry.speaker.toLowerCase();
      if (["patient", "user", "human"].includes(s)) {
        pairs.push({ question: null, answer: entry.text });
      } else {
        pairs.push({ question: entry.text, answer: null });
      }
      i++;
      continue;
    }

    // ── Generic fallback ──
    const text = entry.text || entry.message || entry.value || entry.transcript || "";
    if (text && typeof text === "string" && text.trim()) {
      if (isUser || role === "patient") {
        pairs.push({ question: null, answer: text });
      } else {
        pairs.push({ question: text, answer: null });
      }
    }
    i++;
  }

  // ── 2. Legacy fallback from top-level fields ──
  if (pairs.length === 0 && json) {
    const qs = Array.isArray(json.questions) ? json.questions : [];
    const ans = json.answers && typeof json.answers === "object" && !Array.isArray(json.answers) ? json.answers : {};
    const ansKeys = Object.keys(ans);
    for (let j = 0; j < qs.length; j++) {
      if (qs[j] && typeof qs[j] === "string" && qs[j].trim()) {
        const ak = ansKeys[j];
        pairs.push({
          question: qs[j],
          answer: ak !== undefined ? extractAnswerText(ans[ak]) : null,
        });
      }
    }
  }

  // ── 3. Assign round numbers and fill placeholders ──
  const rounds = pairs.map((p, idx) => ({
    round: idx + 1,
    question: p.question != null ? p.question : "Вопрос не был сохранён",
    answer: p.answer != null ? p.answer : "Ответ не был сохранён",
  }));

  return { rounds, patientText };
}

function extractPatientText(json) {
  if (!json) return "";
  return (
    json.patient_text || json.patientText || json.patient_input ||
    json.text || json.input_text || json.input || json.original_text ||
    json.session?.initial_text || json.session?.patient_text ||
    ""
  );
}

function extractAnswerText(val) {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object") return val.text || val.content || JSON.stringify(val);
  return String(val);
}

/**
 * Build conversation_pairs array from a flat conversationHistory array
 * and optional legacy top-level questions/answers.
 * Each pair: { round, question, answer, created_at }.
 */
export function buildConversationPairs(conversationHistory, json) {
  const { rounds } = normalizeConversationHistory(conversationHistory, json);
  const now = new Date().toISOString();
  return rounds.map((r) => ({
    round: r.round,
    question: r.question,
    answer: r.answer,
    created_at: now,
  }));
}

// ─── Migration normalizer: reconstruct pairs for old records ─────

/**
 * Migrate a single session or case_review record to add conversation_pairs.
 * Reads legacy conversation history and writes the normalized pairs array.
 * Returns { migrated: boolean, pairs: Array, patientText: string }.
 */
export function migrateConversationPairs(sessionRecord) {
  const rawHistory =
    sessionRecord.conversation_history ||
    sessionRecord.conversationHistory ||
    (sessionRecord.json_data && (
      sessionRecord.json_data.conversation_history ||
      sessionRecord.json_data.conversationHistory
    )) ||
    [];

  const json = sessionRecord.json_data || sessionRecord;

  const { rounds, patientText } = normalizeConversationHistory(rawHistory, json);

  if (rounds.length === 0) {
    return { migrated: false, pairs: [], patientText };
  }

  const pairs = rounds.map((r) => ({
    round: r.round,
    question: r.question,
    answer: r.answer,
    created_at: sessionRecord.created_at || sessionRecord.createdAt || new Date().toISOString(),
  }));

  return { migrated: true, pairs, patientText };
}

// ─── Report extraction helpers ──────────────────────────────────

function extractReportFromAiResult(aiResult, reportType) {
  if (!aiResult) return "";
  const targetField = reportType === "user_report" ? "user_report" : "doctor_report";
  const altField = reportType === "user_report" ? "patient_report" : "specialist_report";

  if (typeof aiResult === "object" && !Array.isArray(aiResult)) {
    return aiResult[targetField] || aiResult[altField] || "";
  }

  if (typeof aiResult === "string") {
    try {
      const parsed = JSON.parse(aiResult);
      if (parsed && typeof parsed === "object") {
        return parsed[targetField] || parsed[altField] || "";
      }
    } catch { /* not JSON */ }

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

export function extractUserReport(review, j) {
  const j_ = j || {};
  const r = review || {};

  if (r.user_report) return r.user_report;
  if (r.patient_report) return r.patient_report;

  if (j_.user_report) return j_.user_report;
  if (j_.patient_report) return j_.patient_report;

  if (j_.result?.user_report) return j_.result.user_report;
  if (j_.result?.patient_report) return j_.result.patient_report;
  if (j_.report?.user_report) return j_.report.user_report;
  if (j_.report?.patient_report) return j_.report.patient_report;

  if (j_.session?.user_report) return j_.session.user_report;
  if (j_.session?.patient_report) return j_.session.patient_report;

  if (j_.final_report) return j_.final_report;
  if (j_.analysis?.user_report) return j_.analysis.user_report;

  const fromAi = extractReportFromAiResult(j_.ai_result, "user_report");
  if (fromAi) return fromAi;
  const fromAiTop = extractReportFromAiResult(r.ai_result, "user_report");
  if (fromAiTop) return fromAiTop;

  if (j_.report && typeof j_.report === "string") return j_.report;
  if (r.report && typeof r.report === "string") return r.report;

  return "";
}

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
  const fromAiTop = extractReportFromAiResult(r.ai_result, "doctor_report");
  if (fromAiTop) return fromAiTop;

  return "";
}

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
 * Returns { patientText, rounds, userReport, doctorReport, doctorFeedback }.
 */
export function normalizeSessionDetails(review) {
  const json = (review?.json_data);
  const j = (json && typeof json === "object" && !Array.isArray(json)) ? json :
            (typeof json === "string" ? (() => { try { return JSON.parse(json); } catch { return {}; } })() : {});

  const r = review || {};

  const patientText =
    r.patient_text || r.text || r.input_text || r.patient_input ||
    j.patient_text || j.text || j.input_text || j.original_text ||
    j.patient_input || j.input ||
    j.session?.initial_text || j.session?.patient_text ||
    "";

  const rawHistory =
    j.conversation_history || j.conversationHistory ||
    r.conversation_history || r.conversationHistory ||
    j.session?.conversation_history || j.session?.conversationHistory ||
    [];

  const { rounds, patientText: ptFromHistory } = normalizeConversationHistory(rawHistory, j);

  const userReport = extractUserReport(r, j);
  const doctorReport = extractDoctorReport(r, j);
  const doctorFeedback = extractExpertFeedback(r, j);

  return {
    patientText: patientText || ptFromHistory,
    rounds,
    userReport,
    doctorReport,
    doctorFeedback,
  };
}
