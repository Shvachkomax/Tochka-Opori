import { applyCors, handleOptions } from "../lib/security/cors.js";
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
        return res.status(200).json(await searchSimilarCases({ ...enriched, allowSyntheticFallback: false }));
      case "listQueryHistory":
        return res.status(200).json({ ok: true, items: listQueryHistory({ actorId: actor.id, organizationId }) });
      case "getPrices":
        return res.status(200).json({ ok: true, prices: getKnowledgePrices() });
      default:
        return res.status(400).json({ ok: false, error: "Unknown action" });
    }
  } catch (error) {
    console.error("[clinical-knowledge] error:", error);
    return res.status(500).json({ ok: false, error: "Внутренняя ошибка сервера" });
  }
}
