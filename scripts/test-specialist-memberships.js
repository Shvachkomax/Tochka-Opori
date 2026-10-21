import assert from "node:assert/strict";
import { buildSpecialistClientList } from "../lib/specialist-client-list.js";
import { loadSpecialistMemberships } from "../lib/specialist-memberships.js";

function createSupabase({ memberships, membershipError = null, organizations, organizationError = null }) {
  const selects = [];
  return {
    selects,
    from(table) {
      let result;
      if (table === "expert_organization_memberships") {
        result = { data: memberships, error: membershipError };
      } else if (table === "organizations") {
        result = { data: organizations, error: organizationError };
      } else {
        throw new Error(`Unexpected table: ${table}`);
      }
      const query = {
        select(columns) {
          selects.push({ table, columns });
          return query;
        },
        eq() { return query; },
        in() { return query; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return query;
    },
  };
}

const db = createSupabase({
  memberships: [
    { id: "membership-demo", organization_id: "org-anmed-demo", role: "doctor", status: "active" },
  ],
  organizations: [
    { id: "org-anmed-demo", name: "АнМед — учебный контур", slug: "anmed-demo-test", type: "private_clinic" },
  ],
});
const loaded = await loadSpecialistMemberships(db, "expert-demo");
assert.equal(loaded.error, null);
assert.deepEqual(loaded.memberships, [{
  membership_id: "membership-demo",
  organization_id: "org-anmed-demo",
  organization_name: "АнМед — учебный контур",
  organization_slug: "anmed-demo-test",
  organization_type: "private_clinic",
  role_in_organization: "doctor",
}]);
assert.deepEqual(db.selects, [
  { table: "expert_organization_memberships", columns: "id, organization_id, role, status" },
  { table: "organizations", columns: "id, name, slug, type" },
]);

const membershipQueryFailure = await loadSpecialistMemberships(createSupabase({
  memberships: null,
  membershipError: { code: "PGRST200" },
  organizations: [],
}), "expert-demo");
assert.equal(membershipQueryFailure.memberships, null, "query errors must not become an empty/private-practice membership list");
assert.equal(membershipQueryFailure.error.code, "PGRST200");

const organizationQueryFailure = await loadSpecialistMemberships(createSupabase({
  memberships: [{ id: "membership-demo", organization_id: "org-anmed-demo", role: "doctor", status: "active" }],
  organizations: null,
  organizationError: { code: "ORG_LOOKUP_FAILED" },
}), "expert-demo");
assert.equal(organizationQueryFailure.memberships, null);
assert.equal(organizationQueryFailure.error.code, "ORG_LOOKUP_FAILED");

const orphanMembership = await loadSpecialistMemberships(createSupabase({
  memberships: [{ id: "membership-demo", organization_id: "missing-org", role: "doctor", status: "active" }],
  organizations: [],
}), "expert-demo");
assert.equal(orphanMembership.memberships, null);
assert.equal(orphanMembership.error.code, "MEMBERSHIP_ORGANIZATION_MISSING");

const noMemberships = await loadSpecialistMemberships(createSupabase({ memberships: [], organizations: [] }), "expert-demo");
assert.deepEqual(noMemberships, { memberships: [], error: null });

const assignedClients = buildSpecialistClientList({
  module: "support",
  assignments: [{
    id: "assignment-demo",
    public_code: "ТОЧКА-DEMO-0001",
    status: "active",
    updated_at: "2026-09-30T12:00:00.000Z",
    patient_label: "Синтетический пациент АнМед 01",
  }],
  accessRows: [],
});
assert.deepEqual(assignedClients, [{
  client_ref: "assignment:assignment-demo",
  module: "support",
  display_name: "Синтетический пациент АнМед 01",
  relationship: "primary",
  access_role: "owner",
  status: "active",
  last_activity_at: "2026-09-30T12:00:00.000Z",
}]);

console.log("Specialist membership regression tests passed.");
