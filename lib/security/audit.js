import { getSupabase } from "../supabase.js";

// Sanitize action name — only allow known actions
const ALLOWED_ACTIONS = [
  "admin_login_success",
  "admin_login_failure",
  "export_jsonl",
  "export_expert_cases",
  "delete_body_intake",
  "restore_body_intake",
  "delete_body_daily_log",
  "save_expert_review",
  "save_specialist_note",
  "create_council_invitation",
  "revoke_council_invitation",
  "approve_council_expert",
  "reject_council_expert",
  "pause_council_expert",
  "restore_council_expert",
  "export_council_experts",
  "council_invitation_trashed",
  "council_expert_trashed",
  "council_invitation_restored",
  "council_expert_restored",
  "council_invitation_purged",
  "council_expert_purged",
  "council_email_draft_created",
  "council_email_draft_updated",
  "council_email_test_sent",
  "council_email_campaign_started",
  "council_email_campaign_completed",
  "council_email_campaign_cancelled",
  "usage_wallet_created",
  "usage_wallet_paused",
  "usage_wallet_restored",
  "usage_manual_refill",
  "usage_admin_adjustment",
  "usage_ledger_exported",
];

export async function logAdminAction(adminRole, action, options = {}) {
  if (!ALLOWED_ACTIONS.includes(action)) {
    console.warn(`[audit] Unknown action attempted: ${action}`);
    return;
  }

  const { targetType, targetId, module, ipAddress, success, details } = options;

  try {
    const supabase = getSupabase();
    await supabase.from("admin_audit_log").insert({
      admin_role: adminRole,
      action,
      target_type: targetType || null,
      target_id: targetId ? String(targetId) : null,
      module: module || null,
      ip_address: ipAddress || null,
      success: success !== false,
      details: details || {},
    });
  } catch (err) {
    // Fail open — audit logging should never break admin operations
    console.warn("[audit] Failed to write audit log:", err.message);
  }
}

// Extract client IP from request
export function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.socket?.remoteAddress
    || "unknown";
}
