import { getSupabase } from "../supabase.js";
import { validateSessionAccess } from "./access-token.js";

const SESSION_REQUIRED_STAGES = new Set(["daily_log_submitted", "plate_photo_analysis"]);

export async function validateAnalyzeSessionAccess(
  { sessionId, module, stage, depth, accessToken },
  dependencies = {},
) {
  const hasSessionId = typeof sessionId === "string" && sessionId.trim().length > 0;
  const sessionRequired = SESSION_REQUIRED_STAGES.has(stage)
    || (module === "support" && !stage && Number(depth) >= 3);
  if (!hasSessionId) {
    return {
      allowed: !sessionRequired,
      missingSession: sessionRequired,
    };
  }

  if (!accessToken || !["support", "body"].includes(module)) {
    return { allowed: false, missingSession: false };
  }

  const supabase = dependencies.supabase || getSupabase();
  const validateAccess = dependencies.validateAccess || validateSessionAccess;

  let hasOwner = false;
  if (module === "support") {
    const { data: session, error } = await supabase
      .from("sessions")
      .select("session_id, anonymous_owner_id, module, legacy_access")
      .eq("session_id", sessionId)
      .maybeSingle();
    hasOwner = !error
      && session?.module === "support"
      && Boolean(session?.anonymous_owner_id)
      && session.legacy_access !== true;
  } else {
    const { data: client, error } = await supabase
      .from("body_clients")
      .select("anonymous_owner_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("session_id, anonymous_owner_id, module, legacy_access")
      .eq("session_id", sessionId)
      .maybeSingle();
    hasOwner = !error
      && !sessionError
      && Boolean(client?.anonymous_owner_id)
      && session?.module === "body"
      && session?.anonymous_owner_id === client.anonymous_owner_id
      && session.legacy_access !== true;
  }

  if (!hasOwner) return { allowed: false, missingSession: false };

  return {
    allowed: await validateAccess(sessionId, accessToken),
    missingSession: false,
  };
}
