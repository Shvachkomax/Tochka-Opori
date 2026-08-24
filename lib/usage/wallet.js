import { getSupabase } from "../supabase.js";

const INITIAL_BALANCE = 22000;

function operationRequestId(prefix, walletId) {
  return `${prefix}-${walletId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function ensureWallet({
  ownerType,
  ownerId,
  module,
}) {
  const supabase = getSupabase();

  // After Phase 11D this keeps wallet creation and its initial ledger entry in
  // one database transaction. The fallback is only for pre-migration local
  // schemas, where the RPC does not exist yet.
  const { data: ensured, error: ensureError } = await supabase.rpc("ensure_usage_wallet", {
    p_owner_type: ownerType,
    p_owner_id: ownerId,
    p_module: module,
  });
  if (!ensureError && ensured) {
    return Array.isArray(ensured) ? ensured[0] || null : ensured;
  }
  if (ensureError && !["PGRST202", "42883"].includes(ensureError.code)) {
    console.error("[wallet] ensure_usage_wallet error:", ensureError.message);
    return null;
  }

  const { data: existing } = await supabase
    .from("usage_wallets")
    .select("id, balance, status, visible_to_client, cycle_number, total_used")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("module", module)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("usage_wallets")
    .insert({
      owner_type: ownerType,
      owner_id: ownerId,
      module,
      balance: INITIAL_BALANCE,
      refill_amount: INITIAL_BALANCE,
      total_refilled: INITIAL_BALANCE,
      visible_to_client: false,
    })
    .select("id, balance, status, visible_to_client, cycle_number, total_used")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: retry } = await supabase
        .from("usage_wallets")
        .select("id, balance, status, visible_to_client, cycle_number, total_used")
        .eq("owner_type", ownerType)
        .eq("owner_id", ownerId)
        .eq("module", module)
        .maybeSingle();
      if (retry) return retry;
    }
    console.error("[wallet] ensureWallet error:", error.message);
    return null;
  }

  const { error: ledgerError } = await supabase.from("usage_ledger").insert({
    wallet_id: created.id,
    entry_type: "initial_credit",
    amount: INITIAL_BALANCE,
    balance_before: 0,
    balance_after: INITIAL_BALANCE,
    module,
    request_id: `initial-wallet-${created.id}`,
  });

  if (ledgerError && ledgerError.code !== "23505") {
    console.error("[wallet] initial ledger error:", ledgerError.message);
    return null;
  }

  return created;
}

export async function getWallet({
  ownerType,
  ownerId,
  module,
}) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("usage_wallets")
    .select("id, balance, status, visible_to_client, cycle_number, total_used, total_refilled, refill_amount, refill_mode, continuation_enabled_at")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("module", module)
    .maybeSingle();

  return data || null;
}

export async function setWalletVisible({
  walletId,
}) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("usage_wallets")
    .update({
      visible_to_client: true,
      continuation_enabled_at: new Date().toISOString(),
    })
    .eq("id", walletId);

  if (error) {
    console.error("[wallet] setWalletVisible error:", error.message);
    return false;
  }
  return true;
}

export async function consumeCredits({
  walletId,
  amount,
  requestId,
  resourceType,
  module,
  sessionId,
  provider,
  model,
  inputTokens,
  outputTokens,
  audioSeconds,
  imageCount,
  estimatedCost,
  metadata,
}) {
  const supabase = getSupabase();

  if (amount <= 0) {
    return {
      balance_before: 0,
      charged: 0,
      balance_after: 0,
      refill_count: 0,
      cycle_number: 0,
      idempotent_replay: false,
    };
  }

  const { data, error } = await supabase.rpc("consume_usage_credits", {
    p_wallet_id: walletId,
    p_amount: amount,
    p_request_id: requestId,
    p_resource_type: resourceType || null,
    p_module: module || "support",
    p_session_id: sessionId || null,
    p_provider: provider || null,
    p_model: model || null,
    p_input_tokens: inputTokens ?? null,
    p_output_tokens: outputTokens ?? null,
    p_audio_seconds: audioSeconds ?? null,
    p_image_count: imageCount ?? null,
    p_estimated_cost: estimatedCost ?? null,
    p_metadata: metadata || null,
  });

  if (error) {
    console.error("[wallet] consumeCredits error:", error.message);
    return null;
  }

  return data;
}

export async function getUsageBalanceForClient({
  walletId,
}) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("usage_wallets")
    .select("balance, visible_to_client, refill_amount, refill_mode, cycle_number, total_used, status")
    .eq("id", walletId)
    .maybeSingle();

  if (!data) return { ok: true, visible: false };

  if (!data.visible_to_client || data.status !== "active") {
    return { ok: true, visible: false };
  }

  const summary = await getWalletSummary({ walletId, wallet: data });

  return {
    ok: true,
    visible: true,
    balance: summary.available_credits,
    available_credits: summary.available_credits,
    reserved_credits: summary.reserved_credits,
    balance_total: summary.balance_total,
    refill_amount: data.refill_amount,
    refill_mode: data.refill_mode,
    cycle_number: data.cycle_number,
    total_used: data.total_used,
    is_test_balance: true,
  };
}

export async function getWalletSummary({ walletId, wallet = null }) {
  const supabase = getSupabase();
  const current = wallet || await supabase
    .from("usage_wallets")
    .select("id, balance, total_used, status")
    .eq("id", walletId)
    .maybeSingle()
    .then(({ data }) => data);

  if (!current) return null;

  const { data: reservations, error } = await supabase
    .from("usage_reservations")
    .select("amount")
    .eq("wallet_id", walletId)
    .eq("status", "active");
  // Keep the pre-11D cabinet readable until the reservation migration is applied.
  if (error && !["PGRST205", "42P01"].includes(error.code)) throw error;

  const reservedCredits = (reservations || []).reduce((sum, reservation) => sum + Number(reservation.amount || 0), 0);
  return {
    available_credits: Number(current.balance || 0),
    reserved_credits: reservedCredits,
    balance_total: Number(current.balance || 0) + reservedCredits,
    total_used: Number(current.total_used || 0),
    status: current.status,
  };
}

export async function setWalletStatus({ walletId, status }) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("usage_wallets")
    .update({ status })
    .eq("id", walletId);
  if (error) {
    console.error("[wallet] setWalletStatus error:", error.message);
    return false;
  }
  return true;
}

export async function manualRefill({ walletId, amount, reason, adminPassword }) {
  const supabase = getSupabase();
  const requestId = operationRequestId("manual-refill", walletId);
  const { data: adjusted, error: adjustmentError } = await supabase.rpc("adjust_usage_wallet", {
    p_wallet_id: walletId,
    p_amount: amount,
    p_entry_type: "manual_refill",
    p_request_id: requestId,
    p_reason: reason || "Manual refill",
  });
  if (!adjustmentError) {
    if (!adjusted?.ok) return { success: false, error: adjusted?.error || "Wallet adjustment failed" };
    return {
      success: true,
      balance_before: adjusted.balance_before,
      balance_after: adjusted.balance_after,
    };
  }
  if (!["PGRST202", "42883"].includes(adjustmentError.code)) {
    return { success: false, error: adjustmentError.message };
  }

  const { data: wallet } = await supabase
    .from("usage_wallets")
    .select("balance, total_refilled")
    .eq("id", walletId)
    .single();

  if (!wallet) return { success: false, error: "Wallet not found" };

  const { data: ledger, error } = await supabase
    .from("usage_ledger")
    .insert({
      wallet_id: walletId,
      entry_type: "manual_refill",
      amount,
      balance_before: wallet.balance,
      balance_after: wallet.balance + amount,
      module: "support",
      request_id: `manual-refill-${walletId}-${Date.now()}`,
      metadata: { reason, admin: adminPassword ? true : false },
    })
    .select("balance_after")
    .single();

  if (error) return { success: false, error: error.message };

  await supabase
    .from("usage_wallets")
    .update({
      balance: ledger.balance_after,
      total_refilled: wallet.total_refilled + amount,
    })
    .eq("id", walletId);

  return { success: true, balance_after: ledger.balance_after };
}

export async function adminAdjustment({ walletId, amount, reason, adminPassword }) {
  const supabase = getSupabase();
  const requestId = operationRequestId("admin-adjustment", walletId);
  const { data: adjusted, error: adjustmentError } = await supabase.rpc("adjust_usage_wallet", {
    p_wallet_id: walletId,
    p_amount: amount,
    p_entry_type: "admin_adjustment",
    p_request_id: requestId,
    p_reason: reason || "Admin adjustment",
  });
  if (!adjustmentError) {
    if (!adjusted?.ok) return { success: false, error: adjusted?.error || "Wallet adjustment failed" };
    return {
      success: true,
      balance_before: adjusted.balance_before,
      balance_after: adjusted.balance_after,
    };
  }
  if (!["PGRST202", "42883"].includes(adjustmentError.code)) {
    return { success: false, error: adjustmentError.message };
  }

  const { data: wallet } = await supabase
    .from("usage_wallets")
    .select("balance, total_refilled, total_used")
    .eq("id", walletId)
    .single();

  if (!wallet) return { success: false, error: "Wallet not found" };

  const newBalance = wallet.balance + amount;
  const isRefund = amount > 0;

  const { data: ledger, error } = await supabase
    .from("usage_ledger")
    .insert({
      wallet_id: walletId,
      entry_type: "admin_adjustment",
      amount,
      balance_before: wallet.balance,
      balance_after: newBalance,
      module: "support",
      request_id: `admin-adj-${walletId}-${Date.now()}`,
      metadata: { reason, admin: true },
    })
    .select("balance_after")
    .single();

  if (error) return { success: false, error: error.message };

  await supabase
    .from("usage_wallets")
    .update({
      balance: newBalance,
      ...(isRefund ? { total_refilled: wallet.total_refilled + amount } : { total_used: wallet.total_used + Math.abs(amount) }),
    })
    .eq("id", walletId);

  return { success: true, balance_before: wallet.balance, balance_after: newBalance };
}
