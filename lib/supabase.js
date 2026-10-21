import { deploymentOrganizationId, scopeDatabase } from "./security/deployment-scope.js";
import { createClient } from "@supabase/supabase-js";

let _supabase = null;

export function getSupabase() {
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
