import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { getSupabase } from "../lib/supabase.js";
import { accessTokenMatchesHash } from "../lib/security/access-token.js";
import { resolveUsageOwner } from "../lib/security/usage-session-owner.js";
import { hasBodySessionReference, isAnMedSupportOnlyDeployment, rejectUnavailableModule } from "../lib/security/module-availability.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, prefix: "usage:" });
  const limited = await limit(req, res);
  if (limited) return;

  const { action } = req.body || {};

  try {
    switch (action) {
      case "getUsageBalance":
        return await handleGetUsageBalance(req, res);
      case "getRecentUsage":
        return await handleGetRecentUsage(req, res);
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Internal error" });
  }
}

async function resolveOwner(sessionId, module, accessToken) {
  if (!sessionId || !accessToken || !["support", "body"].includes(module)) return null;
  const supabase = getSupabase();
  return resolveUsageOwner({
    sessionId,
    module,
    accessToken,
    findSession: async (id, requestedModule) => {
      const { data, error } = await supabase
        .from("sessions")
        .select("session_id, module, anonymous_owner_id, access_token_hash, legacy_access, json_data")
        .eq("session_id", id)
        .eq("module", requestedModule)
        .maybeSingle();
      return error ? null : data;
    },
    findBodyClient: async (id) => {
      const { data, error } = await supabase
        .from("body_clients")
        .select("session_id, anonymous_owner_id")
        .eq("session_id", id)
        .maybeSingle();
      return error ? null : data;
    },
    validateAccess: (_id, token, session) => accessTokenMatchesHash(token, session.access_token_hash),
  });
}

function denyUsageAccess(res) {
  // The same response is used for a missing session, invalid token, module
  // mismatch, stale public code, and a token belonging to another owner.
  return res.status(401).json({ ok: false, error: "Не удалось открыть данные баланса." });
}

async function handleGetUsageBalance(req, res) {
  const { sessionId, module, publicCode, access_token } = req.body || {};

  if (rejectUnavailableModule(res, module)) return;
  if (isAnMedSupportOnlyDeployment() && hasBodySessionReference({ sessionId, publicCode })) {
    return res.status(403).json({ ok: false, error: "Модуль недоступен в этой сборке" });
  }

  if (!module || !["support", "body"].includes(module)) {
    return res.status(400).json({ ok: false, error: "Invalid module" });
  }

  const resolvedOwner = await resolveOwner(sessionId, module, access_token);
  if (!resolvedOwner) return denyUsageAccess(res);

  const { getWallet, getUsageBalanceForClient } = await import("../lib/usage/wallet.js");
  const wallet = await getWallet({
    ownerType: resolvedOwner.ownerType,
    ownerId: resolvedOwner.ownerId,
    module: resolvedOwner.module,
  });

  if (!wallet) {
    return res.json({ ok: true, visible: false });
  }

  const balance = await getUsageBalanceForClient({ walletId: wallet.id });
  return res.json(balance);
}

async function handleGetRecentUsage(req, res) {
  const { sessionId, module, publicCode, access_token } = req.body || {};

  if (rejectUnavailableModule(res, module)) return;
  if (isAnMedSupportOnlyDeployment() && hasBodySessionReference({ sessionId, publicCode })) {
    return res.status(403).json({ ok: false, error: "Модуль недоступен в этой сборке" });
  }

  if (!module || !["support", "body"].includes(module)) {
    return res.status(400).json({ ok: false, error: "Invalid module" });
  }

  const resolvedOwner = await resolveOwner(sessionId, module, access_token);
  if (!resolvedOwner) return denyUsageAccess(res);

  const supabase = getSupabase();

  const { data: wallet } = await supabase
    .from("usage_wallets")
    .select("id")
    .eq("owner_type", resolvedOwner.ownerType)
    .eq("owner_id", resolvedOwner.ownerId)
    .eq("module", resolvedOwner.module)
    .maybeSingle();

  if (!wallet) {
    return res.json({ ok: true, entries: [] });
  }

  const { data: entries } = await supabase
    .from("usage_ledger")
    .select("entry_type, amount, resource_type, created_at")
    .eq("wallet_id", wallet.id)
    .eq("entry_type", "usage_debit")
    .order("created_at", { ascending: false })
    .limit(10);

  const { RESOURCE_NAMES } = await import("../lib/usage/credit-calculator.js");
  const safe = (entries || []).map((e) => ({
    name: RESOURCE_NAMES[e.resource_type] || "AI-операция",
    amount: e.amount,
    date: e.created_at,
  }));

  return res.json({ ok: true, entries: safe });
}
