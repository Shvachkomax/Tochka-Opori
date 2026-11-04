export async function resolveExpertByAccessCode({ expertId, expertCode, findActiveExpert } = {}) {
  if (typeof expertCode !== "string" || !expertCode.trim() || typeof findActiveExpert !== "function") return null;

  let expert;
  try {
    expert = await findActiveExpert(expertCode.trim().toUpperCase());
  } catch {
    return null;
  }

  if (!expert || expert.is_active !== true || !expert.id) return null;
  if (expertId && String(expertId) !== String(expert.id)) return null;
  return expert;
}
