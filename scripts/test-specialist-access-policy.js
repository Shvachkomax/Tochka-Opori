import assert from "node:assert/strict";
import {
  canAccessPatientOrganization,
  canReadSpecialistRecord,
  canViewExpandedPatientData,
} from "../lib/specialist/access-policy.js";

assert.equal(canViewExpandedPatientData({ relationship: "primary", accessRole: "owner" }), true);
for (const accessRole of ["owner", "clinician", "supervisor", "admin"]) {
  assert.equal(canViewExpandedPatientData({ relationship: "shared", accessRole }), true, `${accessRole} keeps the existing expanded-access rule`);
}
for (const accessRole of ["viewer", "observer", "unknown", null, undefined]) {
  assert.equal(canViewExpandedPatientData({ relationship: "shared", accessRole }), false, `${accessRole ?? "missing role"} is denied expanded clinical data`);
}
assert.equal(canViewExpandedPatientData({ relationship: "unknown", accessRole: "admin" }), false);
assert.equal(canViewExpandedPatientData(null), false);
assert.equal(canViewExpandedPatientData({ relationship: "shared", accessRole: "viewer", organizationRole: "doctor" }), false);
assert.equal(canViewExpandedPatientData({ relationship: "shared", accessRole: "viewer", organizationRole: "supervisor" }), false, "organization supervisor membership does not override the patient grant role");

assert.equal(canAccessPatientOrganization({ organizationId: "org-a", activeOrganizationIds: ["org-a"] }), true);
assert.equal(canAccessPatientOrganization({ organizationId: "org-b", activeOrganizationIds: ["org-a"] }), false);
assert.equal(canAccessPatientOrganization({ organizationId: null, activeOrganizationIds: ["org-a"] }), true, "private-practice assignment remains available");
assert.equal(canAccessPatientOrganization({ organizationId: "org-a", requestedOrganizationId: "org-a", hasRequestedOrganization: true, activeOrganizationIds: ["org-a"] }), true);
assert.equal(canAccessPatientOrganization({ organizationId: "org-b", requestedOrganizationId: "org-a", hasRequestedOrganization: true, activeOrganizationIds: ["org-a", "org-b"] }), false, "selected org context is enforced");
assert.equal(canAccessPatientOrganization({ organizationId: null, requestedOrganizationId: null, hasRequestedOrganization: true, activeOrganizationIds: ["org-a"] }), true);
assert.equal(canAccessPatientOrganization({ organizationId: "org-a", requestedOrganizationId: "org-a", hasRequestedOrganization: true, isAdmin: true }), true);
assert.equal(canAccessPatientOrganization({ organizationId: "org-b", requestedOrganizationId: "org-a", hasRequestedOrganization: true, isAdmin: true }), false);

const specialistScope = {
  expertId: "expert-a",
  allowedModules: ["support"],
  memberships: [{ organization_id: "org-a", role: "supervisor" }],
  primaryAssignments: [
    { public_code: "ТОЧКА-PRIMARY-0001", module: "support", organization_id: "org-a" },
  ],
  patientAccess: [
    { public_code: "ТОЧКА-AAAA-BBBB", module: "support", organization_id: "org-a", access_role: "clinician" },
    { public_code: "ТОЧКА-VIEW-0001", module: "support", organization_id: "org-a", access_role: "viewer" },
    { public_code: "ТОЧКА-SUPER-0001", module: "support", organization_id: "org-a", access_role: "supervisor" },
  ],
};
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: null, primary_expert_id: "expert-a" }), false, "a record expert ID alone is not an explicit patient grant");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "body", organization_id: null, primary_expert_id: "expert-a" }), false, "module scope is enforced before patient assignment");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-a", public_code: "ТОЧКА-AAAA-BBBB" }), true, "shared clinician access is scoped to its patient and organization");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-a", public_code: "ТОЧКА-VIEW-0001" }), false, "shared viewer access cannot read review records");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-a", public_code: "ТОЧКА-SUPER-0001" }), true, "supervisor grant applies only to the explicitly granted patient");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-a", public_code: "ТОЧКА-ORG-ONLY", expert_id: "expert-a", primary_expert_id: "expert-a" }), false, "organization membership and record expert IDs do not grant patient access");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-b", expert_id: "expert-a" }), false, "a record in an unauthorized organization is denied");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-a", public_code: "ТОЧКА-PRIMARY-0001" }), true, "active primary patient assignment grants scoped access");
assert.equal(canReadSpecialistRecord({ ...specialistScope, primaryAssignments: [] }, { module: "support", organization_id: "org-a", public_code: "ТОЧКА-PRIMARY-0001", primary_expert_id: "expert-a" }), false, "stale record assignment does not outlive the active patient grant");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-a", expert_id: "expert-a" }), true, "self-authored entries without a patient reference remain available to their author");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-a", expert_id: "expert-a", session_id: "session-without-current-grant" }), false, "self-authorship does not bypass patient access for a linked session");
assert.equal(canReadSpecialistRecord(specialistScope, { module: "support", organization_id: "org-a", public_code: "ТОЧКА-AAAA-BBBB" }, "ТОЧКА-AAAA-BBBB"), true);

console.log("Specialist access policy tests passed: explicit patient grants, roles, module and organization scope.");
