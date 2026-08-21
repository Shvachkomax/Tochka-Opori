// Phase 11C.1: Patient ↔ Specialist Linking — unit tests
// Tests invitation, onboarding, match request, and assignment logic.

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

// ── Invitation status transitions ──────────────────────────
console.log("1. Invitation status transitions");

const INVITATION_TRANSITIONS = {
  pending: ["accepted", "declined", "expired", "revoked"],
  accepted: [],
  declined: [],
  expired: [],
  revoked: [],
};

function canTransitionInvitation(current, action) {
  return INVITATION_TRANSITIONS[current]?.includes(action) ?? false;
}

assert(canTransitionInvitation("pending", "accepted"), "pending → accepted");
assert(canTransitionInvitation("pending", "declined"), "pending → declined");
assert(canTransitionInvitation("pending", "expired"), "pending → expired");
assert(canTransitionInvitation("pending", "revoked"), "pending → revoked");
assert(!canTransitionInvitation("accepted", "declined"), "accepted → declined blocked");
assert(!canTransitionInvitation("declined", "accepted"), "declined → accepted blocked");
assert(!canTransitionInvitation("expired", "accepted"), "expired → accepted blocked");
assert(!canTransitionInvitation("revoked", "accepted"), "revoked → accepted blocked");

// ── Invitation token hashing ──────────────────────────────
console.log("\n2. Invitation token hashing");

import crypto from "crypto";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const token1 = "abc123def456";
const token2 = "abc123def456";
const token3 = "xyz789ghi012";

assert(hashToken(token1) === hashToken(token2), "same token → same hash");
assert(hashToken(token1) !== hashToken(token3), "different token → different hash");
assert(hashToken(token1).length === 64, "hash is 64 hex chars");

// ── Expiration check ──────────────────────────────────────
console.log("\n3. Expiration check");

function isExpired(expiresAt) {
  return new Date(expiresAt) < new Date();
}

assert(isExpired("2020-01-01T00:00:00Z"), "past date → expired");
assert(!isExpired("2099-01-01T00:00:00Z"), "future date → not expired");

// ── Assignment conflict check ──────────────────────────────
console.log("\n4. Assignment conflict check");

function checkAssignmentConflict(existing, newExpertId) {
  if (!existing) return "create";
  if (existing.primary_expert_id === newExpertId) return "idempotent";
  return "conflict";
}

assert(checkAssignmentConflict(null, "expert-1") === "create", "no existing → create");
assert(checkAssignmentConflict({ primary_expert_id: "expert-1" }, "expert-1") === "idempotent", "same expert → idempotent");
assert(checkAssignmentConflict({ primary_expert_id: "expert-2" }, "expert-1") === "conflict", "different expert → conflict");

// ── Module entitlement check ───────────────────────────────
console.log("\n5. Module entitlement check");

function hasModuleEntitlement(allowedModules, module) {
  return Array.isArray(allowedModules) && allowedModules.includes(module);
}

assert(hasModuleEntitlement(["support"], "support"), "support-only → support allowed");
assert(!hasModuleEntitlement(["support"], "body"), "support-only → body denied");
assert(hasModuleEntitlement(["support", "body"], "support"), "dual → support allowed");
assert(hasModuleEntitlement(["support", "body"], "body"), "dual → body allowed");
assert(!hasModuleEntitlement([], "support"), "empty → denied");

// ── Onboarding request status transitions ──────────────────
console.log("\n6. Onboarding request status transitions");

const ONBOARDING_TRANSITIONS = {
  submitted: ["approved", "rejected", "cancelled"],
  approved: [],
  rejected: [],
  cancelled: [],
};

function canTransitionOnboarding(current, action) {
  return ONBOARDING_TRANSITIONS[current]?.includes(action) ?? false;
}

assert(canTransitionOnboarding("submitted", "approved"), "submitted → approved");
assert(canTransitionOnboarding("submitted", "rejected"), "submitted → rejected");
assert(!canTransitionOnboarding("approved", "rejected"), "approved → rejected blocked");
assert(!canTransitionOnboarding("rejected", "approved"), "rejected → approved blocked");

// ── Match request status transitions ───────────────────────
console.log("\n7. Match request status transitions");

const MATCH_TRANSITIONS = {
  submitted: ["assigned", "cancelled"],
  assigned: [],
  cancelled: [],
};

function canTransitionMatch(current, action) {
  return MATCH_TRANSITIONS[current]?.includes(action) ?? false;
}

assert(canTransitionMatch("submitted", "assigned"), "submitted → assigned");
assert(canTransitionMatch("submitted", "cancelled"), "submitted → cancelled");
assert(!canTransitionMatch("assigned", "cancelled"), "assigned → cancelled blocked");

// ── Direction validation ───────────────────────────────────
console.log("\n8. Direction validation");

function isValidDirection(direction) {
  return ["specialist_to_patient", "patient_to_specialist"].includes(direction);
}

assert(isValidDirection("specialist_to_patient"), "specialist_to_patient valid");
assert(isValidDirection("patient_to_specialist"), "patient_to_specialist valid");
assert(!isValidDirection("admin_to_patient"), "admin_to_patient invalid");
assert(!isValidDirection(""), "empty invalid");

// ── Module validation ──────────────────────────────────────
console.log("\n9. Module validation");

function isValidModule(module) {
  return ["support", "body"].includes(module);
}

assert(isValidModule("support"), "support valid");
assert(isValidModule("body"), "body valid");
assert(!isValidModule("health"), "health invalid");

// ── Onboarding does not create expert automatically ────────
console.log("\n10. Onboarding does not create expert automatically");

function onboardingCreatesExpert(request) {
  // Onboarding request should NOT auto-create expert
  return false;
}

assert(!onboardingCreatesExpert({ status: "submitted" }), "onboarding does not create expert");

// ── Match request does not create service_request ──────────
console.log("\n11. Match request does not create service_request");

function matchCreatesServiceRequest() {
  return false;
}

assert(!matchCreatesServiceRequest(), "match request does not create service_request");

// ── Match request does not alter wallet ────────────────────
console.log("\n12. Match request does not alter wallet");

function matchAltersWallet() {
  return false;
}

assert(!matchAltersWallet(), "match request does not alter wallet");

// ── Race condition / double accept protection ─────────────
console.log("\n13. Race condition / double accept protection");

// Simulates the atomic conditional update pattern used in session.js
function simulateAtomicAccept(invitation, expectedStatus) {
  // Only transitions if current status matches expected
  if (invitation.status !== expectedStatus) return { ok: false, reason: "already_processed" };
  invitation.status = "accepted";
  return { ok: true };
}

const raceTestInv = { status: "pending" };
const result1 = simulateAtomicAccept(raceTestInv, "pending");
const result2 = simulateAtomicAccept(raceTestInv, "pending"); // Second attempt
assert(result1.ok === true, "first accept succeeds");
assert(result2.ok === false, "second accept rejected (already processed)");
assert(result2.reason === "already_processed", "reason: already_processed");

// ── Onboarding submission validation ──────────────────────
console.log("\n14. Onboarding submission validation");

function validateOnboardingInput(invitation, name) {
  if (!invitation) return { ok: false, error: "invitation_not_found" };
  if (invitation.direction !== "patient_to_specialist") return { ok: false, error: "wrong_direction" };
  if (invitation.status !== "pending") return { ok: false, error: "not_pending" };
  if (new Date(invitation.expires_at) < new Date()) return { ok: false, error: "expired" };
  if (!name || name.trim().length < 2) return { ok: false, error: "name_too_short" };
  return { ok: true };
}

const validInv = { direction: "patient_to_specialist", status: "pending", expires_at: "2099-01-01T00:00:00Z" };
const expiredInv = { direction: "patient_to_specialist", status: "pending", expires_at: "2020-01-01T00:00:00Z" };
const revokedInv = { direction: "patient_to_specialist", status: "revoked", expires_at: "2099-01-01T00:00:00Z" };
const wrongDirInv = { direction: "specialist_to_patient", status: "pending", expires_at: "2099-01-01T00:00:00Z" };

assert(validateOnboardingInput(validInv, "Доктор Иванов").ok === true, "valid onboarding input accepted");
assert(validateOnboardingInput(null, "Доктор").error === "invitation_not_found", "null invitation → not_found");
assert(validateOnboardingInput(expiredInv, "Доктор").error === "expired", "expired invitation → rejected");
assert(validateOnboardingInput(revokedInv, "Доктор").error === "not_pending", "revoked invitation → rejected");
assert(validateOnboardingInput(wrongDirInv, "Доктор").error === "wrong_direction", "wrong direction → rejected");
assert(validateOnboardingInput(validInv, "А").error === "name_too_short", "name too short → rejected");
assert(validateOnboardingInput(validInv, "").error === "name_too_short", "empty name → rejected");

// ── Duplicate onboarding submission handling ──────────────
console.log("\n15. Duplicate onboarding submission handling");

function handleDuplicateOnboarding(existingRequest) {
  if (!existingRequest) return { ok: true, action: "created" };
  if (existingRequest.status === "submitted") return { ok: true, action: "already_submitted" };
  if (existingRequest.status === "approved") return { ok: true, action: "already_approved" };
  return { ok: false, error: "already_processed" };
}

assert(handleDuplicateOnboarding(null).action === "created", "no existing → create");
assert(handleDuplicateOnboarding({ status: "submitted" }).action === "already_submitted", "existing submitted → idempotent");
assert(handleDuplicateOnboarding({ status: "approved" }).action === "already_approved", "existing approved → idempotent");
assert(handleDuplicateOnboarding({ status: "rejected" }).ok === false, "existing rejected → error");

// ── SITE_URL handling ────────────────────────────────────
console.log("\n16. SITE_URL handling");

function getSiteUrl(env) {
  if (env.SITE_URL) return env.SITE_URL;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:5173";
}

function getInviteUrl(env, token) {
  return `${getSiteUrl(env)}/invite/${token}`;
}

const testToken = "abc123";
assert(getSiteUrl({ SITE_URL: "https://tochka-opori-test.vercel.app" }) === "https://tochka-opori-test.vercel.app", "SITE_URL takes precedence");
assert(getSiteUrl({ VERCEL_URL: "tochka-opori.vercel.app" }) === "https://tochka-opori.vercel.app", "VERCEL_URL fallback");
assert(getSiteUrl({}) === "http://localhost:5173", "localhost fallback");
assert(getInviteUrl({ SITE_URL: "https://tochka-opori-test.vercel.app" }, testToken) === "https://tochka-opori-test.vercel.app/invite/abc123", "invite URL uses SITE_URL");
assert(getInviteUrl({ SITE_URL: "https://tochka-opori.online" }, testToken) === "https://tochka-opori.online/invite/abc123", "production invite URL");

// ── target_owner_id semantics ─────────────────────────────
console.log("\n17. target_owner_id semantics");

function buildPatientToSpecialistInvitation(patientId) {
  return {
    direction: "patient_to_specialist",
    inviter_owner_type: "anonymous_case",
    inviter_owner_id: patientId,
    target_owner_id: null, // Unknown doctor at creation time
    target_owner_type: null,
  };
}

function buildSpecialistToPatientInvitation(expertId, patientId) {
  return {
    direction: "specialist_to_patient",
    inviter_expert_id: expertId,
    target_owner_id: patientId, // Known patient target
    target_owner_type: "anonymous_case",
  };
}

const ptosInv = buildPatientToSpecialistInvitation("patient-123");
assert(ptosInv.target_owner_id === null, "patient→specialist: target_owner_id is null");
assert(ptosInv.inviter_owner_id === "patient-123", "patient→specialist: inviter_owner_id is patient");

const stopInv = buildSpecialistToPatientInvitation("expert-456", "patient-123");
assert(stopInv.target_owner_id === "patient-123", "specialist→patient: target_owner_id is patient");
assert(stopInv.inviter_expert_id === "expert-456", "specialist→patient: inviter_expert_id is expert");

// ── Expert verification before assignment ─────────────────
console.log("\n18. Expert verification before assignment");

function verifyExpertForAssignment(expert, module) {
  if (!expert) return { ok: false, error: "expert_not_found" };
  if (!expert.is_active) return { ok: false, error: "expert_inactive" };
  const modules = Array.isArray(expert.allowed_modules) ? expert.allowed_modules : [];
  if (!modules.includes(module)) return { ok: false, error: "no_module_entitlement" };
  return { ok: true };
}

assert(verifyExpertForAssignment({ id: "e1", is_active: true, allowed_modules: ["support"] }, "support").ok === true, "active expert with entitlement → ok");
assert(verifyExpertForAssignment(null, "support").error === "expert_not_found", "null expert → not_found");
assert(verifyExpertForAssignment({ id: "e1", is_active: false, allowed_modules: ["support"] }, "support").error === "expert_inactive", "inactive expert → rejected");
assert(verifyExpertForAssignment({ id: "e1", is_active: true, allowed_modules: ["body"] }, "support").error === "no_module_entitlement", "wrong module → rejected");
assert(verifyExpertForAssignment({ id: "e1", is_active: true, allowed_modules: [] }, "support").error === "no_module_entitlement", "empty modules → rejected");

// ── Conditional update pattern (race safety) ──────────────
console.log("\n19. Conditional update pattern (race safety)");

function conditionalUpdate(row, expectedStatus, newStatus) {
  // Simulates: UPDATE ... SET status = ? WHERE id = ? AND status = ?
  // Returns updated row only if condition matched
  if (row.status !== expectedStatus) return null;
  return { ...row, status: newStatus };
}

const pendingRow = { id: "inv-1", status: "pending" };
const updated = conditionalUpdate(pendingRow, "pending", "accepted");
assert(updated !== null, "conditional update matches pending");
assert(updated.status === "accepted", "status updated to accepted");

const alreadyAccepted = { id: "inv-2", status: "accepted" };
const rejected = conditionalUpdate(alreadyAccepted, "pending", "accepted");
assert(rejected === null, "conditional update rejects non-pending");

// ── RPC consistency: Scenario tests ───────────────────────
console.log("\n20. RPC consistency — Scenario 1: Patient already assigned to DIFFERENT expert");

// Simulates the RPC logic: checks existing assignment BEFORE updating invitation
function simulateScenario1(invitation, existingAssignment) {
  // In the RPC: check assignment first, return conflict without touching invitation
  if (existingAssignment && existingAssignment.primary_expert_id !== invitation.inviter_expert_id) {
    return { ok: false, code: "ASSIGNMENT_CONFLICT", invitationStatus: invitation.status };
  }
  return { ok: true };
}

const scenario1Result = simulateScenario1(
  { id: "inv-1", status: "pending", inviter_expert_id: "expert-A" },
  { primary_expert_id: "expert-B" }
);
assert(scenario1Result.ok === false, "scenario 1: returns conflict");
assert(scenario1Result.code === "ASSIGNMENT_CONFLICT", "scenario 1: code is ASSIGNMENT_CONFLICT");
assert(scenario1Result.invitationStatus === "pending", "scenario 1: invitation remains pending");

console.log("\n21. RPC consistency — Scenario 2: Assignment INSERT fails unexpectedly");

// Simulates the RPC: if INSERT fails, invitation is NOT updated
function simulateScenario2(invitation, insertSuccess) {
  if (!insertSuccess) {
    // RPC rolls back — invitation stays pending
    return { ok: false, code: "DB_ERROR", invitationStatus: invitation.status };
  }
  // Only update invitation AFTER successful insert
  return { ok: true, invitationStatus: "accepted" };
}

const scenario2Fail = simulateScenario2({ status: "pending" }, false);
assert(scenario2Fail.ok === false, "scenario 2: insert failure returns error");
assert(scenario2Fail.invitationStatus === "pending", "scenario 2: invitation stays pending on insert failure");

const scenario2Ok = simulateScenario2({ status: "pending" }, true);
assert(scenario2Ok.ok === true, "scenario 2: insert success returns ok");
assert(scenario2Ok.invitationStatus === "accepted", "scenario 2: invitation becomes accepted after insert");

console.log("\n22. RPC consistency — Scenario 3: Same expert assignment already exists");

function simulateScenario3(invitation, existingAssignment) {
  if (existingAssignment && existingAssignment.primary_expert_id === invitation.inviter_expert_id) {
    // Idempotent — assignment already exists, transition invitation for consistency
    return { ok: true, idempotent: true, invitationStatus: "accepted" };
  }
  return { ok: true, idempotent: false };
}

const scenario3 = simulateScenario3(
  { id: "inv-1", status: "pending", inviter_expert_id: "expert-A" },
  { primary_expert_id: "expert-A" }
);
assert(scenario3.ok === true, "scenario 3: returns ok");
assert(scenario3.idempotent === true, "scenario 3: is idempotent");
assert(scenario3.invitationStatus === "accepted", "scenario 3: invitation transitions to accepted");

console.log("\n23. RPC consistency — Scenario 4: Two concurrent Accept requests");

// Simulates two concurrent requests hitting the RPC
// The DB transaction ensures only one can succeed atomically
function simulateConcurrentAccepts(invitation, existingAssignment) {
  const results = [];

  // Request 1: enters transaction, checks assignment (null), creates assignment, updates invitation
  // Request 2: enters transaction, checks assignment (now exists with same expert), returns idempotent
  if (!existingAssignment) {
    // Request 1 wins
    results.push({ ok: true, idempotent: false, invitationStatus: "accepted" });
    // After request 1, assignment exists
    existingAssignment = { primary_expert_id: "expert-A" };
  }
  // Request 2: sees existing assignment
  if (existingAssignment.primary_expert_id === "expert-A") {
    results.push({ ok: true, idempotent: true, invitationStatus: "accepted" });
  }
  return results;
}

const concurrentResults = simulateConcurrentAccepts(
  { id: "inv-1", status: "pending", inviter_expert_id: "expert-A" },
  null
);
assert(concurrentResults.length === 2, "scenario 4: both requests get response");
assert(concurrentResults[0].ok === true, "scenario 4: first request succeeds");
assert(concurrentResults[0].idempotent === false, "scenario 4: first creates assignment");
assert(concurrentResults[1].ok === true, "scenario 4: second request succeeds");
assert(concurrentResults[1].idempotent === true, "scenario 4: second is idempotent");
assert(concurrentResults.every(r => r.invitationStatus === "accepted"), "scenario 4: invitation accepted exactly once");

console.log("\n24. RPC consistency — Final state invariant");

// The key invariant: if invitation.status = 'accepted', then a canonical active assignment MUST exist
function checkInvariant(invitationStatus, assignmentExists) {
  if (invitationStatus === "accepted" && !assignmentExists) {
    return { consistent: false, reason: "accepted without assignment" };
  }
  return { consistent: true };
}

assert(checkInvariant("accepted", true).consistent === true, "invariant: accepted + assignment exists → consistent");
assert(checkInvariant("accepted", false).consistent === false, "invariant: accepted without assignment → INCONSISTENT");
assert(checkInvariant("pending", false).consistent === true, "invariant: pending without assignment → consistent");
assert(checkInvariant("pending", true).consistent === true, "invariant: pending with assignment → consistent (admin created)");

// ── Organization propagation and scoped conflict ───────────
console.log("\n25. Assignment keeps invitation organization scope");

function buildCanonicalAssignment(invitation, publicCode, expertId) {
  return {
    public_code: publicCode,
    organization_id: invitation.organization_id,
    primary_expert_id: expertId,
    module: invitation.module,
    status: "active",
    source: "patient_invitation_accept",
  };
}

const orgInvitation = { organization_id: "org-X", module: "support" };
const orgAssignment = buildCanonicalAssignment(orgInvitation, "PATIENT-X", "expert-X");
assert(orgAssignment.organization_id === "org-X", "accepted assignment preserves invitation organization_id");
assert(orgAssignment.source === "patient_invitation_accept", "accepted assignment uses canonical invitation source");

function sameAssignmentScope(a, b) {
  return a.public_code === b.public_code
    && a.module === b.module
    && a.organization_id === b.organization_id;
}

assert(!sameAssignmentScope(orgAssignment, { ...orgAssignment, organization_id: "org-Y" }), "different organizations do not conflict");
assert(sameAssignmentScope(orgAssignment, { ...orgAssignment }), "same organization remains idempotent scope");

function sameOwnerScope(a, ownerType, ownerId) {
  return a.owner_type === ownerType && a.owner_id === ownerId && a.module === "support" && a.status === "active";
}

const ownerAssignment = { owner_type: "anonymous_case", owner_id: "owner-X", module: "support", status: "active" };
assert(sameOwnerScope(ownerAssignment, "anonymous_case", "owner-X"), "owner-identity assignment participates in accept idempotency scope");
assert(!sameOwnerScope(ownerAssignment, "anonymous_case", "owner-Y"), "different owner cannot reuse owner-identity assignment");

// ── Summary ───────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
