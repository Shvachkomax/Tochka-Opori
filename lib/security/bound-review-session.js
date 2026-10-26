export async function resolveBoundReviewSession({
  supabase,
  sessionId,
  accessToken,
  deploymentOrganizationId,
  validateAccess,
}) {
  if (!supabase || !sessionId || !accessToken || !deploymentOrganizationId || typeof validateAccess !== "function") {
    return { ok: false, session: null };
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .select("session_id, public_code, organization_id, primary_expert_id, module, access_token_hash, legacy_access")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error || !session || session.organization_id !== deploymentOrganizationId
      || session.legacy_access === true || !session.access_token_hash) {
    return { ok: false, session: null };
  }
  if (!(await validateAccess(sessionId, accessToken))) {
    return { ok: false, session: null };
  }
  return { ok: true, session };
}
