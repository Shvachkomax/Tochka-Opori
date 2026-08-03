-- Health AI Coach — Migration 030
-- Adds: body_onboarding, body_plate_history, body_weekly_summaries,
--        body_ai_chat, body_insights
-- Also: new AI fields on body_daily_logs
-- Idempotent, additive only, no data deletion.

-- ============================================================
-- 1. body_onboarding — owner-level diary preferences
-- ============================================================

create table if not exists body_onboarding (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null default 'anonymous_profile',
  owner_id uuid not null,

  intro_completed boolean not null default false,
  intro_completed_at timestamptz,

  activity_tracker_used boolean,
  activity_tracker_name text,
  activity_tracker_other text,
  tracked_metrics jsonb not null default '[]'::jsonb,

  calorie_tracking_mode text,
  calorie_tracking_app text,
  calorie_tracking_other text,

  data_entry_preference text,
  priority_metrics jsonb not null default '[]'::jsonb,
  support_style text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(owner_type, owner_id),

  constraint body_onboarding_owner_check
    check (owner_type = 'anonymous_profile')
);

create index if not exists idx_body_onboarding_owner
  on body_onboarding(owner_id);

-- ============================================================
-- 2. body_plate_history — structured per-photo observations
-- ============================================================

create table if not exists body_plate_history (
  id uuid primary key default gen_random_uuid(),

  owner_type text not null default 'anonymous_profile',
  owner_id uuid not null,

  session_id text not null,
  daily_log_id uuid,
  log_date date not null,
  meal_type text,

  photo_ref text,
  photo_index integer,

  detected_foods jsonb,
  plate_components jsonb,
  vegetables_assessment text,
  protein_assessment text,
  carbohydrate_assessment text,

  balance_summary text,
  what_is_missing jsonb,
  gentle_suggestion text,
  confidence numeric,

  model_used text,
  prompt_version text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint body_plate_history_owner_check
    check (owner_type = 'anonymous_profile')
);

create index if not exists idx_plate_history_owner_date
  on body_plate_history(owner_id, log_date desc);

create index if not exists idx_plate_history_daily_log
  on body_plate_history(daily_log_id);

create index if not exists idx_plate_history_session
  on body_plate_history(session_id);

create index if not exists idx_plate_history_owner_created
  on body_plate_history(owner_id, created_at desc);

-- ============================================================
-- 3. body_weekly_summaries — owner-level period summaries
-- ============================================================

create table if not exists body_weekly_summaries (
  id uuid primary key default gen_random_uuid(),

  owner_type text not null default 'anonymous_profile',
  owner_id uuid not null,

  summary_type text not null default 'weekly',
  period_start date not null,
  period_end date not null,

  source_days integer not null default 0,
  source_plate_count integer not null default 0,

  summary_json jsonb not null,
  user_summary text,
  focus_next_period jsonb,

  model_used text,
  request_id text not null,
  generation_status text not null default 'ready',
  error_code text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(owner_type, owner_id, summary_type, period_start),

  constraint body_weekly_summaries_owner_check
    check (owner_type = 'anonymous_profile'),

  constraint body_weekly_summaries_type_check
    check (summary_type in ('weekly', 'monthly', 'milestone'))
);

create index if not exists idx_weekly_summaries_owner
  on body_weekly_summaries(owner_id, period_start desc);

-- ============================================================
-- 4. body_ai_chat — AI companion conversation
-- ============================================================

create table if not exists body_ai_chat (
  id uuid primary key default gen_random_uuid(),

  owner_type text not null default 'anonymous_profile',
  owner_id uuid not null,

  session_id text,
  role text not null,
  message_text text not null,

  context_snapshot jsonb,
  related_daily_log_id uuid,
  related_plate_id uuid,
  related_summary_id uuid,

  request_id text,
  model_used text,

  created_at timestamptz not null default now(),

  constraint body_ai_chat_owner_check
    check (owner_type = 'anonymous_profile'),

  constraint body_ai_chat_role_check
    check (role in ('user', 'assistant', 'system'))
);

create index if not exists idx_ai_chat_owner_created
  on body_ai_chat(owner_id, created_at desc);

create index if not exists idx_ai_chat_related_daily_log
  on body_ai_chat(related_daily_log_id);

create index if not exists idx_ai_chat_related_plate
  on body_ai_chat(related_plate_id);

create index if not exists idx_ai_chat_related_summary
  on body_ai_chat(related_summary_id);

-- ============================================================
-- 5. body_insights — automatic pattern observations
-- ============================================================

create table if not exists body_insights (
  id uuid primary key default gen_random_uuid(),

  owner_type text not null default 'anonymous_profile',
  owner_id uuid not null,

  insight_type text not null,
  insight_date date not null,

  title text,
  insight_text text not null,
  priority text not null default 'normal',

  source_kind text,
  source_ids jsonb not null default '[]'::jsonb,

  status text not null default 'active',
  fingerprint text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(owner_type, owner_id, fingerprint),

  constraint body_insights_owner_check
    check (owner_type = 'anonymous_profile'),

  constraint body_insights_type_check
    check (
      insight_type in (
        'nutrition_pattern',
        'activity_pattern',
        'sleep_pattern',
        'wellbeing_pattern',
        'progress',
        'warning',
        'positive_change'
      )
    ),

  constraint body_insights_priority_check
    check (priority in ('low', 'normal', 'high')),

  constraint body_insights_status_check
    check (status in ('active', 'resolved', 'dismissed'))
);

create index if not exists idx_insights_owner_status
  on body_insights(owner_id, status, priority, created_at desc);

create index if not exists idx_insights_fingerprint
  on body_insights(owner_id, fingerprint);

-- ============================================================
-- 6. New AI fields on body_daily_logs
-- ============================================================

alter table body_daily_logs
  add column if not exists ai_positive_observation text;

alter table body_daily_logs
  add column if not exists ai_pattern_observation text;

alter table body_daily_logs
  add column if not exists ai_question_for_user text;

alter table body_daily_logs
  add column if not exists ai_analysis_status text;

alter table body_daily_logs
  add column if not exists ai_analysis_request_id text;

alter table body_daily_logs
  add column if not exists ai_analysis_model text;

alter table body_daily_logs
  add column if not exists daily_log_version integer default 1;

-- ============================================================
-- 7. Reload PostgREST schema cache
-- ============================================================

notify pgrst, 'reload schema';
