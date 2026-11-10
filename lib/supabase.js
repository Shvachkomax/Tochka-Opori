import { deploymentOrganizationId, scopeDatabase } from "./security/deployment-scope.js";
import { isMyPracticeServerEnabled } from "./my-practice/workspace-handler.js";
import { createClient } from "@supabase/supabase-js";

let _supabase = null;

export function getSupabase() {
  // Branch-scoped fail-closed guard: prevent ALL database access in the
  // My Practice Preview until the exact test project and feature gate are ready.
  if (process.env.MY_PRACTICE_REQUIRE_TEST_DB === "true" && !isMyPracticeServerEnabled(process.env)) {
    throw new Error("My Practice Preview: verified test database credentials not configured");
  }
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    _supabase = scopeDatabase(createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ), deploymentOrganizationId());
  }
  return _supabase;
}
