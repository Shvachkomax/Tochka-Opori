import { applyCors, handleOptions } from "../lib/security/cors.js";
import { authorizeSpecialist } from "./specialist.js";
import { getSupabase } from "../lib/supabase.js";

// Test-only clinical contributions. Does not accept or store patient identifiers.
const MODULES = ["support", "health"];
const TEXT_FIELDS = {
  title: 180, complaints: 2800, anamnesis: 4000, diagnosis: 700,
  examinations: 2500, psychotherapy: 2200, other_treatment: 2200,
  outcomes: 2400, adverse_events: 1400, observation_period: 350, clinical_limitations: 1600,
};
const AGE_BANDS = ["не указана", "0–17", "18–29", "30–44", "45–59", "60–74", "75+"];
const SEX_VALUES = ["не указано", "женский", "мужской", "другое"];
const PRIVATE_DATA_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+7|8)[\s()-]*\d{3}[\s()-]*\d{3}[\s()-]*\d{2}[\s()-]*\d{2}/,
  /\b\d{2}[./-]\d{2}[./-](?:19|20)\d{2}\b/,
  /(?:паспорт|снилс|номер карты пациента|адрес проживания|телефон пациента|фио пациента)/i,
];
function enabled() {
  if (process.env.CLINICAL_CONTRIBUTIONS_ENABLED === "true") return true;
  return process.env.VERCEL_ENV === "preview"
    && /^tochka-opori-clinical-test-[a-z0-9-]+\.vercel\.app$/.test(process.env.VERCEL_URL || "");
}
function allowedModules(expert) {
  const raw = Array.isArray(expert.allowed_modules) ? expert.allowed_modules : [];
  return MODULES.filter((m) => raw.includes(m === "health" ? "body" : "support"));
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  try {
    const url = new URL(origin);
    return url.host === host && (url.protocol === "https:" || url.hostname === "localhost");
  } catch { return false; }
}
function trimText(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function validateAndNormalize(caseData) {
  if (!caseData || typeof caseData !== "object" || Array.isArray(caseData)) throw Error("Не заполнена карточка");
  if (!MODULES.includes(caseData.module)) throw Error("Укажите направление Support или Health");
  const row = { module: caseData.module };
  for (const [key, max] of Object.entries(TEXT_FIELDS)) row[key] = trimText(caseData[key], max);
  row.age_band = AGE_BANDS.includes(caseData.age_band) ? caseData.age_band : "не указана";
  row.sex = SEX_VALUES.includes(caseData.sex) ? caseData.sex : "не указано";
  row.medications = (Array.isArray(caseData.medications) ? caseData.medications : []).slice(0, 15).map((m) => ({
    inn: trimText(m?.inn, 160), dose: trimText(m?.dose, 200),
    purpose: trimText(m?.purpose, 350), result: trimText(m?.result, 450),
  })).filter((m) => m.inn);
  row.deidentified_confirmed = caseData.deidentified_confirmed === true;
  row.lawful_use_confirmed = caseData.lawful_use_confirmed === true;
  return row;
}
function checkSubmission(c) {
  if (!c.deidentified_confirmed || !c.lawful_use_confirmed)
    return "Подтвердите обезличивание и законные основания использования сведений";
  if (c.title.length < 8 || c.complaints.length < 12 || c.diagnosis.length < 4 || c.outcomes.length < 8)
    return "Для экспертизы укажите заголовок, жалобы, диагноз и результаты";
  const combined = [...Object.keys(TEXT_FIELDS).map((k) => c[k]), ...c.medications.flatMap((m) => Object.values(m))].join(" ");
  if (PRIVATE_DATA_PATTERNS.some((re) => re.test(combined)))
    return "Найдены возможные личные сведения пациента. Удалите контакты, даты рождения и идентификаторы";
  return null;
}
function jsonError(res, status, error) { return res.status(status).json({ ok: false, error }); }
function isReviewer(expert) { return ["clinical_reviewer", "platform_admin"].includes(expert?.role); }

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!enabled()) return jsonError(res, 404, "Функция пока доступна только в Clinical-Test");
  if (req.method !== "POST") return jsonError(res, 405, "Требуется POST");
  if (!sameOrigin(req)) return jsonError(res, 403, "Запрос с другого сайта запрещён");
  const auth = await authorizeSpecialist(req);
  if (auth.status) return jsonError(res, auth.status, auth.error);
  const expert = auth.expert;
  const modules = allowedModules(expert);
  if (!modules.length) return jsonError(res, 403, "Нет доступа к клиническому модулю");
  const body = req.body || {};
  const db = getSupabase();

  try {
    if (body.action === "mine") {
      const { data, error } = await db.from("clinical_contributions")
        .select("*").eq("author_expert_id", expert.id).order("updated_at", { ascending: false }).limit(80);
      if (error) throw error;
      const { data: bonuses, error: bonusError } = await db.from("clinical_contribution_bonus_ledger")
        .select("points").eq("expert_id", expert.id).limit(1000);
      if (bonusError) throw bonusError;
      return res.status(200).json({
        ok: true, items: (data || []).filter((r) => modules.includes(r.module)),
        demo_points: (bonuses || []).reduce((s, x) => s + x.points, 0),
        points_redeemable: false, is_demo: true, reviewer: isReviewer(expert), allowed_modules: modules,
      });
    }

    if (body.action === "save") {
      const c = validateAndNormalize(body.case);
      if (!modules.includes(c.module)) return jsonError(res, 403, "Нет доступа к направлению");
      const org = body.organization_id || null;
      if (org && !(auth.memberships || []).some((m) => m.organization_id === org))
        return jsonError(res, 403, "Нет доступа к организации");
      let result;
      if (body.id) {
        const { data: current, error } = await db.from("clinical_contributions")
          .select("id,author_expert_id,organization_id,status,version,module")
          .eq("id", body.id).eq("author_expert_id", expert.id).maybeSingle();
        if (error) throw error;
        if (!current) return jsonError(res, 404, "Черновик не найден");
        if (!["draft", "changes_requested"].includes(current.status))
          return jsonError(res, 409, "Отправленное наблюдение нельзя менять до решения эксперта");
        if (current.organization_id !== org)
          return jsonError(res, 403, "Нельзя менять рабочее пространство наблюдения");
        const { data, error: updateError } = await db.from("clinical_contributions")
          .update({ ...c, version: current.version + 1, updated_at: new Date().toISOString() })
          .eq("id", current.id).eq("author_expert_id", expert.id)
          .eq("version", current.version).in("status", ["draft", "changes_requested"]).select("*").maybeSingle();
        if (updateError) throw updateError;
        if (!data) return jsonError(res, 409, "Карточка изменена в другом окне; обновите страницу");
        result = data;
      } else {
        const { data, error } = await db.from("clinical_contributions")
          .insert({ ...c, author_expert_id: expert.id, organization_id: org, status: "draft" })
          .select("*").single();
        if (error) throw error;
        result = data;
      }
      return res.status(200).json({ ok: true, item: result });
    }

    if (body.action === "submit") {
      const { data: c, error } = await db.from("clinical_contributions").select("*")
        .eq("id", body.id).eq("author_expert_id", expert.id).maybeSingle();
      if (error) throw error;
      if (!c) return jsonError(res, 404, "Наблюдение не найдено");
      if (!modules.includes(c.module)) return jsonError(res, 403, "Нет доступа к направлению");
      if (!["draft", "changes_requested"].includes(c.status))
        return jsonError(res, 409, "Наблюдение уже отправлено");
      const issue = checkSubmission(c);
      if (issue) return jsonError(res, 400, issue);
      const { data, error: updateError } = await db.from("clinical_contributions")
        .update({ status: "submitted", submitted_at: new Date().toISOString(), version: c.version + 1, updated_at: new Date().toISOString() })
        .eq("id", c.id).eq("author_expert_id", expert.id).eq("version", c.version)
        .in("status", ["draft", "changes_requested"]).select("id,status").maybeSingle();
      if (updateError) throw updateError;
      if (!data) return jsonError(res, 409, "Наблюдение уже изменено");
      return res.status(200).json({ ok: true, item: data });
    }

    if (body.action === "reviewQueue") {
      if (!isReviewer(expert)) return jsonError(res, 403, "Нет прав эксперта");
      const { data, error } = await db.from("clinical_contributions")
        .select("*").eq("status", "submitted").in("module", modules).order("submitted_at").limit(80);
      if (error) throw error;
      return res.status(200).json({ ok: true, items: (data || []).filter((c) => c.author_expert_id !== expert.id) });
    }

    if (body.action === "review") {
      if (!isReviewer(expert)) return jsonError(res, 403, "Нет прав эксперта");
      const comment = trimText(body.comment, 1500);
      if (comment.length < 8) return jsonError(res, 400, "Заключение эксперта должно содержать не меньше 8 символов");
      const decision = body.decision;
      if (!["accept", "changes_requested", "rejected"].includes(decision))
        return jsonError(res, 400, "Неизвестное решение");
      const { data: c, error } = await db.from("clinical_contributions")
        .select("id,status,module,author_expert_id,version").eq("id", body.id).maybeSingle();
      if (error) throw error;
      if (!c) return jsonError(res, 404, "Наблюдение не найдено");
      if (c.author_expert_id === expert.id) return jsonError(res, 403, "Нельзя оценивать собственное наблюдение");
      if (!modules.includes(c.module)) return jsonError(res, 403, "Нет прав на направление");
      if (c.status !== "submitted") return jsonError(res, 409, "Наблюдение уже обработано");
      if (decision === "accept") {
        const { data, error: rpcError } = await db.rpc("accept_clinical_contribution_demo", {
          p_contribution_id: c.id, p_reviewer_id: expert.id, p_comment: comment,
        });
        if (rpcError) throw rpcError;
        if (!data?.ok) return jsonError(res, 409, data?.error || "Принятие отклонено");
        return res.status(200).json({ ok: true, demo_points: data.points, points_redeemable: false });
      }
      const { data, error: updateError } = await db.from("clinical_contributions")
        .update({ status: decision, review_comment: comment, reviewer_expert_id: expert.id,
          reviewed_at: new Date().toISOString(), version: c.version + 1, updated_at: new Date().toISOString() })
        .eq("id", c.id).eq("status", "submitted").eq("version", c.version)
        .select("id,status").maybeSingle();
      if (updateError) throw updateError;
      if (!data) return jsonError(res, 409, "Наблюдение уже рассмотрено другим экспертом");
      return res.status(200).json({ ok: true, item: data });
    }
    return jsonError(res, 400, "Неизвестное действие");
  } catch (err) {
    console.error("[clinical-contributions]", err);
    return jsonError(res, 503, "Не удалось выполнить операцию с тестовой базой");
  }
}
