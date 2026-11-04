const EXPANDED_PATIENT_ACCESS_ROLES = new Set(["owner", "clinician", "supervisor", "admin"]);

// Organization membership only establishes the organization context. Expanded
// clinical access requires a primary assignment or an explicit patient_access
// grant, with the grant's role scoped to that patient and organization.
export function canViewExpandedPatientData(resolved = {}) {
  if (!resolved || typeof resolved !== "object") return false;
  const { relationship, accessRole } = resolved;
  if (relationship === "primary") return true;
  return relationship === "shared" && EXPANDED_PATIENT_ACCESS_ROLES.has(accessRole);
}

export function canReadSpecialistRecord(scope, record, fallbackPublicCode = null) {
  if (!scope || !record || !Array.isArray(scope.allowedModules)) return false;
  const module = record.module || "support";
  if (!scope.allowedModules.includes(module)) return false;

  const organizationId = record.organization_id ?? null;
  const hasOrganizationAccess = (scope.memberships || []).some((row) => row.organization_id === organizationId);
  if (organizationId !== null && !hasOrganizationAccess) return false;

  const publicCode = record.public_code || fallbackPublicCode;
  const ownerType = record.owner_type ?? null;
  const ownerId = record.owner_id ?? null;
  const expertId = String(scope.expertId || "");
  if (!publicCode && !ownerType && !ownerId && !record.session_id
    && expertId && String(record.expert_id || "") === expertId) {
    // Unlinked, self-authored training entries are not patient records.
    return true;
  }
  const samePatient = (grant) => (
    (publicCode && grant.public_code === publicCode)
    || (!publicCode && ownerType && ownerId
      && grant.owner_type === ownerType
      && String(grant.owner_id) === String(ownerId))
  );
  const sameScope = (grant) => (
    grant.module === module
    && (grant.organization_id ?? null) === organizationId
  );

  const hasPrimaryAssignment = (scope.primaryAssignments || []).some((assignment) => (
    samePatient(assignment) && sameScope(assignment)
  ));
  if (hasPrimaryAssignment) return true;

  return (scope.patientAccess || []).some((access) => (
    samePatient(access)
    && sameScope(access)
    && canViewExpandedPatientData({ relationship: "shared", accessRole: access.access_role })
  ));
}

export function canAccessPatientOrganization({
  isAdmin = false,
  organizationId = null,
  requestedOrganizationId,
  hasRequestedOrganization = false,
  activeOrganizationIds = [],
} = {}) {
  const patientOrganizationId = organizationId ?? null;
  const requested = requestedOrganizationId ?? null;
  const active = new Set(activeOrganizationIds.filter(Boolean).map(String));

  if (isAdmin) {
    return !hasRequestedOrganization || patientOrganizationId === requested;
  }
  if (hasRequestedOrganization) {
    if (requested === null) return patientOrganizationId === null;
    return active.has(String(requested)) && patientOrganizationId === requested;
  }
  return patientOrganizationId === null || active.has(String(patientOrganizationId));
}
