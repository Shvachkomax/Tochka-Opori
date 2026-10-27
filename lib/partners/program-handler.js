// Identity comes exclusively from the authenticated specialist session.
export async function handlePartnerProgram(req, res, { authorizeSpecialist, validateSpecialistContext, getSupabase, getPilotId }) {
  res.setHeader("Cache-Control", "no-store");
  const auth = await authorizeSpecialist(req);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const { module, organization_id: organizationId = null } = req.body || {};
  const context = validateSpecialistContext({
    memberships: auth.memberships, organizationId, module, allowedModules: auth.expert.allowed_modules,
  });
  if (!context.ok) return res.status(403).json({ ok: false, error: context.error });
  const args = {
    p_expert_id: auth.expert.id, p_module: module,
    p_organization_id: organizationId, p_pilot_id: getPilotId() || "main",
  };
  const db = getSupabase();
  const [summary, history] = await Promise.all([
    db.rpc("partner_test_summary", args), db.rpc("partner_test_history", args),
  ]);
  const error = summary.error || history.error;
  if (error) {
    const missing = ["PGRST202", "42883", "42P01"].includes(error.code);
    return res.status(missing ? 503 : 500).json({
      ok: false,
      error: missing ? "Партнёрская программа ещё не включена. Начисления появятся после обновления сервиса." : "Не удалось загрузить начисления. Попробуйте ещё раз.",
    });
  }
  if (!summary.data || !Array.isArray(history.data)) {
    return res.status(500).json({ ok: false, error: "Не удалось загрузить начисления. Попробуйте ещё раз." });
  }
  return res.status(200).json({ ok: true, summary: summary.data, history: history.data });
}
