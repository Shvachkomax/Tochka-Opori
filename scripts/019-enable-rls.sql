-- Security Pass 2 — RLS for all user-data tables
-- NOTE: Service role bypasses RLS (all API uses service_role).
-- These policies are a defensive barrier against misconfiguration
-- and future anon-key usage. They do not affect current API behaviour.

-- ============================================================================
-- 1. sessions
-- ============================================================================
alter table if exists sessions enable row level security;

-- Only allow access via service_role (no public anon access)
create policy if not exists "sessions_service_role_only"
  on sessions
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 2. case_reviews
-- ============================================================================
alter table if exists case_reviews enable row level security;

create policy if not exists "case_reviews_service_role_only"
  on case_reviews
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 3. training_sessions
-- ============================================================================
alter table if exists training_sessions enable row level security;

create policy if not exists "training_sessions_service_role_only"
  on training_sessions
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 4. experts
-- ============================================================================
alter table if exists experts enable row level security;

create policy if not exists "experts_service_role_only"
  on experts
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 5. expert_requests
-- ============================================================================
alter table if exists expert_requests enable row level security;

create policy if not exists "expert_requests_service_role_only"
  on expert_requests
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 6. crisis_requests
-- ============================================================================
alter table if exists crisis_requests enable row level security;

create policy if not exists "crisis_requests_service_role_only"
  on crisis_requests
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 7. organizations
-- ============================================================================
alter table if exists organizations enable row level security;

create policy if not exists "organizations_service_role_only"
  on organizations
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 8. expert_organization_memberships
-- ============================================================================
alter table if exists expert_organization_memberships enable row level security;

create policy if not exists "expert_organization_memberships_service_role_only"
  on expert_organization_memberships
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 9. patient_assignments
-- ============================================================================
alter table if exists patient_assignments enable row level security;

create policy if not exists "patient_assignments_service_role_only"
  on patient_assignments
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 10. patient_access
-- ============================================================================
alter table if exists patient_access enable row level security;

create policy if not exists "patient_access_service_role_only"
  on patient_access
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 11. doctor_invite_links
-- ============================================================================
alter table if exists doctor_invite_links enable row level security;

create policy if not exists "doctor_invite_links_service_role_only"
  on doctor_invite_links
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 12. quality_review_insights
-- ============================================================================
alter table if exists quality_review_insights enable row level security;

create policy if not exists "quality_review_insights_service_role_only"
  on quality_review_insights
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 13. body_intake_forms
-- ============================================================================
alter table if exists body_intake_forms enable row level security;

create policy if not exists "body_intake_forms_service_role_only"
  on body_intake_forms
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 14. body_clients
-- ============================================================================
alter table if exists body_clients enable row level security;

create policy if not exists "body_clients_service_role_only"
  on body_clients
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 15. body_daily_logs
-- ============================================================================
alter table if exists body_daily_logs enable row level security;

create policy if not exists "body_daily_logs_service_role_only"
  on body_daily_logs
  using (current_setting('role') = 'service_role');

-- ============================================================================
-- 16. body_expert_reviews
-- ============================================================================
alter table if exists body_expert_reviews enable row level security;

create policy if not exists "body_expert_reviews_service_role_only"
  on body_expert_reviews
  using (current_setting('role') = 'service_role');
