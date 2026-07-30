import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { getSupabase } from "../lib/supabase.js";
import { validateSessionAccess } from "../lib/security/access-token.js";

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

async function resolveOwnerId(sessionId, module, accessToken) {
  const supabase = getSupabase();

  if (module === "support") {
    const { data } = await supabase
      .from("sessions")
      .select("session_id, anonymous_owner_id, legacy_access")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (!data) return null;
    if (!data.legacy_access && accessToken) {
      const valid = await validateSessionAccess(data.session_id, accessToken);
      if (!valid) return null;
    }
    return data.anonymous_owner_id;
  }

  if (module === "body") {
    const { data } = await supabase
      .from("body_clients")
      .select("anonymous_owner_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (!data) return null;
    return data.anonymous_owner_id;
  }

  return null;
}

async function resolveSessionByCode(publicCode) {
  const supabase = getSupabase();
  const normalized = publicCode.trim().toUpperCase();
  const isSupportCode = /^ТОЧКА-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
  const isHealthCode = /^HEALTH-[A-Z0-9]{4}-[A-Z0-9]{3}$/.test(normalized);
  if (!isSupportCode && !isHealthCode) return null;

  const { data } = await supabase
    .from("sessions")
    .select("session_id, anonymous_owner_id")
    .eq("public_code", normalized)
    .maybeSingle();

  if (data) {
    return { sessionId: data.session_id, ownerId: data.anonymous_owner_id, module: isSupportCode ? "support" : "body" };
  }

  // For body codes not in sessions table (legacy), try body_clients
  if (isHealthCode) {
    const { data: bc } = await supabase
      .from("body_clients")
      .select("anonymous_owner_id")
      .eq("session_id", normalized)
      .maybeSingle();
    if (bc && bc.anonymous_owner_id) {
      return { sessionId: normalized, ownerId: bc.anonymous_owner_id, module: "body" };
    }
  }

  return null;
}

async function handleGetUsageBalance(req, res) {
  const { sessionId, module, publicCode, access_token } = req.body || {};

  if (!module || !["support", "body"].includes(module)) {
    return res.status(400).json({ ok: false, error: "Invalid module" });
  }

  let ownerId = null;
  let effectiveSessionId = sessionId;
  let resolvedModule = module;

  if (publicCode) {
    const resolved = await resolveSessionByCode(publicCode);
    if (!resolved) {
      return res.status(404).json({ ok: false, error: "Code not found" });
    }
    ownerId = resolved.ownerId;
    effectiveSessionId = resolved.sessionId;
    resolvedModule = resolved.module;
  } else if (sessionId) {
    ownerId = await resolveOwnerId(sessionId, module, access_token);
  }

  if (!ownerId) {
    return res.json({ ok: true, visible: false });
  }

  const { getWallet, getUsageBalanceForClient } = await import("../lib/usage/wallet.js");
  const ownerType = resolvedModule === "support" ? "anonymous_case" : "anonymous_profile";
  const wallet = await getWallet({ ownerType, ownerId, module: resolvedModule });

  if (!wallet) {
    return res.json({ ok: true, visible: false });
  }

  const balance = await getUsageBalanceForClient({ walletId: wallet.id });
  return res.json(balance);
}

async function handleGetRecentUsage(req, res) {
  const { sessionId, module, publicCode, access_token } = req.body || {};

  if (!module || !["support", "body"].includes(module)) {
    return res.status(400).json({ ok: false, error: "Invalid module" });
  }

  let ownerId = null;
  let resolvedModule = module;

  if (publicCode) {
    const resolved = await resolveSessionByCode(publicCode);
    if (!resolved) {
      return res.status(404).json({ ok: false, error: "Code not found" });
    }
    ownerId = resolved.ownerId;
    resolvedModule = resolved.module;
  } else if (sessionId) {
    ownerId = await resolveOwnerId(sessionId, module, access_token);
  }

  if (!ownerId) {
    return res.json({ ok: true, entries: [] });
  }

  const supabase = getSupabase();
  const ownerType = resolvedModule === "support" ? "anonymous_case" : "anonymous_profile";

  const { data: wallet } = await supabase
    .from("usage_wallets")
    .select("id")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("module", resolvedModule)
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
