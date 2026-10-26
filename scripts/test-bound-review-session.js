import assert from "node:assert/strict";
import { resolveBoundReviewSession } from "../lib/security/bound-review-session.js";

function mockSupabase(session, error = null) {
  return {
    from(table) {
      assert.equal(table, "sessions");
      return {
        select() { return this; },
        eq(column, value) {
          assert.equal(column, "session_id");
          assert.equal(value, "session-a");
          return this;
        },
        async maybeSingle() { return { data: session, error }; },
      };
    },
  };
}

const sessionFixture = { session_id: "session-a", organization_id: "org-pneumo", module: "support", access_token_hash: "stored-hash", legacy_access: false };
const base = {
  supabase: mockSupabase(sessionFixture),
  sessionId: "session-a",
  accessToken: "secret-token",
  deploymentOrganizationId: "org-pneumo",
  validateAccess: async (sessionId, token) => sessionId === "session-a" && token === "secret-token",
};

assert.equal((await resolveBoundReviewSession(base)).ok, true);
assert.equal((await resolveBoundReviewSession({ ...base, accessToken: "wrong-token" })).ok, false);
assert.equal((await resolveBoundReviewSession({ ...base, accessToken: "" })).ok, false);
assert.equal((await resolveBoundReviewSession({ ...base, deploymentOrganizationId: "org-anmed" })).ok, false);
assert.equal((await resolveBoundReviewSession({ ...base, supabase: mockSupabase(null) })).ok, false);
assert.equal((await resolveBoundReviewSession({ ...base, supabase: mockSupabase(null, new Error("db")) })).ok, false);
assert.equal((await resolveBoundReviewSession({ ...base, supabase: mockSupabase({ ...sessionFixture, legacy_access: true }) })).ok, false);
assert.equal((await resolveBoundReviewSession({ ...base, supabase: mockSupabase({ ...sessionFixture, access_token_hash: null }) })).ok, false);

console.log("Bound review session authorization tests passed.");
