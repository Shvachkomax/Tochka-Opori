export const LEGACY_CONTINUATION_CODE_MESSAGE = "Это короткий код из старой версии — по нему нельзя открыть беседу. Если у вас есть устройство, где беседа уже открывается, войдите в личный кабинет и рядом с кнопкой «Продолжить разговор» создайте новый код продолжения. Если такого устройства нет, обратитесь в поддержку сервиса для восстановления доступа.";

export function makeSessionSummary(session = {}) {
  const input = String(session.patient_text || session.json_data?.patient_text || "").trim();
  if (input) {
    const firstSentence = input.split(/[.!?\n]/)[0].trim();
    if (firstSentence) {
      const limited = firstSentence.slice(0, 110);
      return `${limited}${firstSentence.length > 110 ? "…" : ""}`;
    }
  }
  return session.json_data?.isContinuation || session.json_data?.previousPatientReport
    ? "Продолжение разговора"
    : "Первичный разговор";
}

export function getCurrentInvitationStatus(invitation, now = Date.now()) {
  if (invitation?.status === "pending" && invitation.expires_at) {
    const expiresAt = Date.parse(invitation.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= now) return "expired";
  }
  return invitation?.status || "pending";
}

export function normalizeInvitationStatuses(invitations = [], now = Date.now()) {
  return invitations.map((invitation) => ({
    ...invitation,
    status: getCurrentInvitationStatus(invitation, now),
  }));
}
