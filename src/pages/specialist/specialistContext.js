// Request state must be scoped to the authenticated specialist and workspace.

export function buildSpecialistContextKey({ expertId, module, organizationId }) {
  return [
    expertId || "anonymous",
    module || "none",
    organizationId ?? "private",
  ].join("|");
}

export function isCurrentSpecialistContext({
  requestGeneration,
  currentGeneration,
  requestContextKey,
  currentContextKey,
}) {
  return requestGeneration === currentGeneration && requestContextKey === currentContextKey;
}
