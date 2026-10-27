import { applyCors, handleOptions } from "../lib/security/cors.js";
import { setPublishedCaseStatus } from "../lib/clinical/knowledge/providers/published-clinical-cases-provider.js";
import { authorizeSpecialist } from "./specialist.js";
import {
  searchDrugs,
  searchGuidelines,
  searchSimilarCases,
  listQueryHistory,
  getKnowledgePrices,
} from "../lib/clinical/knowledge/service.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await authorizeSpecialist(req);
  if (auth.status) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const body = req.body || {};
  const action = body.action;
  const memberships = auth.memberships || [];
  const actor = { id: auth.expert.id, role: "specialist" };
  const organizationId = body.organization_id || memberships[0]?.organization_id || null;

  if (organizationId && !memberships.some((m) => m.organization_id === organizationId)) {
    return res.status(403).json({ ok: false, error: "Нет доступа к организации" });
  }

  try {
    const enriched = { ...body, actor, memberships, organizationId };
    switch (action) {
      case "searchDrugs":
        return res.status(200).json(await searchDrugs(enriched));
      case "searchGuidelines":
        return res.status(200).json(await searchGuidelines(enriched));
      case "searchSimilarCases":
        return res.status(200).json(await searchSimilarCases({ ...enriched, allowSyntheticFallback: false, allowedModules: auth.expert.allowed_modules || [] }));
      case "listQueryHistory":
        return res.status(200).json({ ok: true, items: listQueryHistory({ actorId: actor.id, organizationId }) });
      case "getPrices":
        return res.status(200).json({ ok: true, prices: getKnowledgePrices() });
      case "assignClinicalReviewer":
        if (!["admin", "platform_admin"].includes(auth.expert.role)) return res.status(403).json({ ok: false, error: "Нет прав администратора" });
        if (!req.body?.expert_id || req.body.expert_id === auth.expert.id) return res.status(400).json({ ok: false, error: "Некорректный expert_id" });
        try {
          const { getSupabase } = await import("../lib/supabase.js");
          const supabase = getSupabase();
          const { error } = await supabase.from("experts").update({ role: "clinical_reviewer" }).eq("id", req.body.expert_id);
          if (error) throw error;
        } catch (e) {
          return res.status(503).json({ ok: false, error: "База данных недоступна" });
        }
        return res.status(200).json({ ok: true });
      case "revokeClinicalReviewer":
        if (!["admin", "platform_admin"].includes(auth.expert.role)) return res.status(403).json({ ok: false, error: "Нет прав администратора" });
        if (!req.body?.expert_id || req.body.expert_id === auth.expert.id) return res.status(400).json({ ok: false, error: "Некорректный expert_id" });
        try {
          const { getSupabase } = await import("../lib/supabase.js");
          const supabase = getSupabase();
          const { error } = await supabase.from("experts").update({ role: "doctor" }).eq("id", req.body.expert_id).eq("role", "clinical_reviewer");
          if (error) throw error;
        } catch (e) {
          return res.status(503).json({ ok: false, error: "База данных недоступна" });
        }
        return res.status(200).json({ ok: true });
      case "listPendingReviews":
        if (auth.expert.role !== "clinical_reviewer") return res.status(403).json({ ok: false, error: "Нет прав рецензента" });
        try {
          const { getSupabase } = await import("../lib/supabase.js");
          const supabase = getSupabase();
          const { data } = await supabase.from("published_clinical_cases").select("*").eq("expert_review_status", "pending_review");
          if (data && data.length) return res.status(200).json({ ok: true, items: data });
        } catch (e) {}
        const mod = await import("../lib/clinical/knowledge/providers/published-clinical-cases-provider.js");
        return res.status(200).json({ ok: true, items: await mod.PublishedClinicalCasesProvider.listPending() });
      case "submitExpertReview":
        if (auth.expert.role !== "clinical_reviewer") return res.status(403).json({ ok: false, error: "Нет прав рецензента" });
        if (auth.expert.id === body.case_author_id) return res.status(403).json({ ok: false, error: "Нельзя утверждать собственную карточку" });
        if (!body.case_id || !body.decision || !body.comment) return res.status(400).json({ ok: false, error: "Неполные данные решения" });
        const idempotencyKey = body.idempotency_key || `${auth.expert.id}:${body.case_id}:${body.version || "noversion"}:${body.decision}`;
        let supabase;
        try {
          const mod = await import("../lib/supabase.js");
          supabase = mod.getSupabase();
        } catch (e) {
          return res.status(503).json({ ok: false, error: "База данных недоступна" });
        }
        if (body.decision === "approve") {
          const { data, error } = await supabase.rpc("approve_published_case", {
            p_reviewer_id: auth.expert.id,
            p_publication_id: body.case_id,
            p_version: body.version || null,
            p_comment: body.comment,
            p_idempotency_key: idempotencyKey,
          });
          if (error) return res.status(500).json({ ok: false, error: "Не удалось сохранить решение" });
          if (!data?.ok) return res.status(409).json({ ok: false, error: data?.error || "Операция отклонена" });
        } else {
          const { error } = await supabase.from("clinical_review_log").insert({
            reviewer_id: auth.expert.id,
            publication_id: body.case_id,
            publication_version: body.version || null,
            decision: body.decision,
            comment: body.comment,
            idempotency_key: idempotencyKey,
          });
          if (error && error.code !== "23505") return res.status(500).json({ ok: false, error: "Не удалось сохранить решение" });
        }
        return res.status(200).json({ ok: true, logged: true });

      default:
        return res.status(400).json({ ok: false, error: "Unknown action" });
    }
  } catch (error) {
    console.error("[clinical-knowledge] error:", error);
    return res.status(500).json({ ok: false, error: "Внутренняя ошибка сервера" });
  }
}

// In-memory expert review state for v0.6 (DB-backed in future migration 049)
const reviewStates = new Map();
const reviewLog = [];
