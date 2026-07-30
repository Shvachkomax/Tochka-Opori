import { getSupabase } from "../supabase.js";
import { ensureWallet, consumeCredits } from "./wallet.js";
import { calculateUsageCost } from "./credit-calculator.js";

export async function debitCreditsForSession({
  sessionId,
  module,
  resourceType,
  requestId,
  provider,
  model,
  inputTokens,
  outputTokens,
  audioSeconds,
  imageCount,
  estimatedCost,
  metadata,
}) {
  try {
    const supabase = getSupabase();
    let ownerType;

    if (module === "support") {
      ownerType = "anonymous_case";
    } else if (module === "body") {
      ownerType = "anonymous_profile";
    } else {
      return { charged: false, skipped: true, skipped_reason: "invalid_module" };
    }

    if (!sessionId) {
      console.warn("[credits] skipped — no session_id", JSON.stringify({ module, resourceType }));
      return { charged: false, skipped: true, skipped_reason: "no_session_id" };
    }

    // Look up canonical owner identity — must exist before debit is called
    let ownerId = null;
    const table = module === "support" ? "sessions" : "body_clients";
    const { data: existing } = await supabase
      .from(table)
      .select("anonymous_owner_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (existing && existing.anonymous_owner_id) {
      ownerId = existing.anonymous_owner_id;
    }

    if (!ownerId) {
      console.warn("[credits] skipped — canonical owner not found", JSON.stringify({
        module, resourceType, hasSessionId: !!sessionId, skipped_reason: "canonical_owner_not_found",
      }));
      return { charged: false, skipped: true, skipped_reason: "canonical_owner_not_found" };
    }

    const wallet = await ensureWallet({ ownerType, ownerId, module });
    if (!wallet) {
      console.warn("[credits] skipped — wallet not created", JSON.stringify({
        module, resourceType, skipped_reason: "wallet_creation_failed",
      }));
      return { charged: false, skipped: true, skipped_reason: "wallet_creation_failed" };
    }

    const amount = calculateUsageCost({ resourceType, inputTokens, outputTokens, audioSeconds, imageCount });

    if (amount <= 0) {
      return { charged: false, skipped: true, skipped_reason: "zero_amount" };
    }

    const result = await consumeCredits({
      walletId: wallet.id,
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
    });

    if (!result) {
      console.error("[credits] consumeCredits failed for", JSON.stringify({ requestId, resourceType, amount }));
      return { charged: false, skipped: true, skipped_reason: "rpc_failed" };
    }

    return { charged: true, skipped: false, amount, balance_after: result.balance_after };
  } catch (err) {
    console.error("[credits] debitCreditsForSession error:", err.message);
    return { charged: false, skipped: true, skipped_reason: "error", error: err.message };
  }
}

export async function setSessionVisibleAfterCode({ sessionId, module }) {
  try {
    const supabase = getSupabase();
    let ownerType;
    if (module === "support") ownerType = "anonymous_case";
    else if (module === "body") ownerType = "anonymous_profile";
    else return { ok: false, reason: "invalid_module" };

    if (!sessionId) return { ok: false, reason: "no_session_id" };

    let ownerId = null;
    if (module === "support") {
      const { data } = await supabase.from("sessions").select("anonymous_owner_id").eq("session_id", sessionId).maybeSingle();
      if (data) ownerId = data.anonymous_owner_id;
    } else {
      const { data } = await supabase.from("body_clients").select("anonymous_owner_id").eq("session_id", sessionId).maybeSingle();
      if (data) ownerId = data.anonymous_owner_id;
    }
    if (!ownerId) return { ok: false, reason: "canonical_owner_not_found" };

    const { ensureWallet, setWalletVisible } = await import("./wallet.js");
    const wallet = await ensureWallet({ ownerType, ownerId, module });
    if (!wallet) return { ok: false, reason: "wallet_not_found" };

    await setWalletVisible({ walletId: wallet.id });
    return { ok: true, walletId: wallet.id };
  } catch (err) {
    console.error("[credits] setSessionVisibleAfterCode error:", err.message);
    return { ok: false, reason: "error", error: err.message };
  }
}
