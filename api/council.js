import { getSupabase } from "../lib/supabase.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { hashToken, generateExpertAccessToken } from "../lib/security/council-token.js";

const EXPERT_TOKEN_MAX_AGE_DAYS = 30;

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, prefix: "council:" });
  const limited = await limit(req, res);
  if (limited) return;

  const { action } = req.body || {};

  try {
    switch (action) {
      case "validateInviteToken":
        return await handleValidateInviteToken(req, res);
      case "acceptInvite":
        return await handleAcceptInvite(req, res);
      case "validateExpertToken":
        return await handleValidateExpertToken(req, res);
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
}

async function handleValidateInviteToken(req, res) {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ ok: false, error: "Missing token" });
  }

  const tokenHash = hashToken(token);
  const supabase = getSupabase();

  const { data: invite, error } = await supabase
    .from("clinical_council_invitations")
    .select("id, invited_first_name, invited_last_name, invited_email, specialty, organization, status, expires_at, use_count, max_uses")
    .eq("token_hash", tokenHash)
    .single();

  if (error || !invite) {
    return res.status(404).json({ ok: false, error: "Приглашение не найдено" });
  }

  if (invite.status === "revoked") {
    return res.status(403).json({ ok: false, error: "Приглашение отозвано" });
  }

  if (invite.status === "accepted") {
    return res.status(403).json({ ok: false, error: "Приглашение уже принято" });
  }

  if (invite.status === "expired") {
    return res.status(403).json({ ok: false, error: "Приглашение истекло" });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(403).json({ ok: false, error: "Приглашение истекло" });
  }

  if (invite.use_count >= (invite.max_uses || 1)) {
    return res.status(403).json({ ok: false, error: "Приглашение уже использовано" });
  }

  // Mark as opened atomically — only if still in 'created' or 'sent' state
  if (invite.status === "created" || invite.status === "sent") {
    await supabase
      .from("clinical_council_invitations")
      .update({ status: "opened", opened_at: new Date().toISOString() })
      .eq("id", invite.id)
      .in("status", ["created", "sent"]);
  }

  return res.status(200).json({
    ok: true,
    invitation: {
      id: invite.id,
      first_name: invite.invited_first_name,
      last_name: invite.invited_last_name,
      email: invite.invited_email,
      specialty: invite.specialty,
      organization: invite.organization,
    },
  });
}

async function handleAcceptInvite(req, res) {
  const { token, first_name, last_name, email, phone, specialty, position, organization, professional_note, public_name_consent } = req.body || {};

  if (!token || !first_name || !last_name || !email) {
    return res.status(400).json({ ok: false, error: "Missing required fields: token, first_name, last_name, email" });
  }

  const tokenHash = hashToken(token);
  const supabase = getSupabase();

  // Step 1: Validate invitation (read-only)
  const { data: invite, error: inviteError } = await supabase
    .from("clinical_council_invitations")
    .select("id, status, use_count, max_uses, expires_at")
    .eq("token_hash", tokenHash)
    .single();

  if (inviteError || !invite) {
    return res.status(404).json({ ok: false, error: "Приглашение не найдено" });
  }

  if (invite.status === "revoked") {
    return res.status(403).json({ ok: false, error: "Приглашение отозвано" });
  }

  if (invite.status === "accepted") {
    return res.status(403).json({ ok: false, error: "Приглашение уже принято" });
  }

  if (invite.status === "expired") {
    return res.status(403).json({ ok: false, error: "Приглашение истекло" });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(403).json({ ok: false, error: "Приглашение истекло" });
  }

  if (invite.use_count >= (invite.max_uses || 1)) {
    return res.status(403).json({ ok: false, error: "Приглашение уже использовано" });
  }

  // Step 2: Atomic reservation — update only if status and use_count unchanged.
  // If two requests race, the second UPDATE will affect 0 rows (status changed or use_count bumped).
  const { error: reserveError } = await supabase
    .from("clinical_council_invitations")
    .update({
      use_count: invite.use_count + 1,
      status: "accepted",
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invite.id)
    .eq("status", invite.status)
    .eq("use_count", invite.use_count);

  if (reserveError) {
    return res.status(500).json({ ok: false, error: "Ошибка бронирования приглашения" });
  }

  // Verify the reservation succeeded (row was actually updated)
  const { data: verifyInvite } = await supabase
    .from("clinical_council_invitations")
    .select("status, use_count")
    .eq("id", invite.id)
    .single();

  if (!verifyInvite || verifyInvite.status !== "accepted" || verifyInvite.use_count !== invite.use_count + 1) {
    return res.status(409).json({ ok: false, error: "Приглашение уже использовано другим пользователем." });
  }

  // Step 3: Check if expert already exists for this email
  const { data: existing } = await supabase
    .from("clinical_council_experts")
    .select("id, status")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ ok: false, error: "Вы уже зарегистрированы в Экспертном совете. Ожидайте подтверждения администратора." });
  }

  // Step 4: Create expert record (pending_review)
  const trimmedFields = {
    first_name: first_name.trim(),
    last_name: last_name.trim(),
    email: email.toLowerCase().trim(),
    phone: phone ? phone.trim() : null,
    specialty: specialty ? specialty.trim() : null,
    position: position ? position.trim() : null,
    organization: organization ? organization.trim() : null,
    professional_note: professional_note ? professional_note.trim() : null,
  };

  const { error: insertError } = await supabase
    .from("clinical_council_experts")
    .insert({
      invitation_id: invite.id,
      ...trimmedFields,
      public_name_consent: !!public_name_consent,
      participation_terms_accepted_at: new Date().toISOString(),
      status: "pending_review",
    });

  if (insertError) {
    // If unique constraint on invitation_id failed, the invitation was already used
    if (insertError.code === "23505") {
      return res.status(409).json({ ok: false, error: "Приглашение уже использовано другим пользователем." });
    }
    console.error("[council] Failed to create expert record:", insertError.message);
    return res.status(500).json({ ok: false, error: "Ошибка создания записи" });
  }

  return res.status(200).json({
    ok: true,
    message: "Заявка отправлена. Ожидайте подтверждения администратора.",
  });
}

async function handleValidateExpertToken(req, res) {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ ok: false, error: "Missing token" });
  }

  const tokenHash = hashToken(token);
  const supabase = getSupabase();

  const { data: expert, error } = await supabase
    .from("clinical_council_experts")
    .select("id, first_name, last_name, email, specialty, position, organization, status, approved_at, access_token_generated_at")
    .eq("access_token_hash", tokenHash)
    .single();

  if (error || !expert) {
    return res.status(401).json({ ok: false, error: "Неверный токен доступа" });
  }

  if (expert.status !== "active") {
    return res.status(403).json({ ok: false, error: "Доступ приостановлен. Обратитесь к администратору." });
  }

  // Check token expiry (30 days max)
  if (expert.access_token_generated_at) {
    const generatedAt = new Date(expert.access_token_generated_at);
    const maxAgeMs = EXPERT_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - generatedAt.getTime() > maxAgeMs) {
      return res.status(403).json({ ok: false, error: "Токен доступа истёк. Обратитесь к администратору для получения нового токена." });
    }
  }

  return res.status(200).json({ ok: true, expert });
}
