create table if not exists training_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public_code text,
  session_id text,
  case_review_id uuid,
  expert_id uuid,
  expert_name text,
  expert_role text,
  session_sequence int,
  session_kind text default 'initial',
  previous_public_code text,
  follow_up_after_days int,
  test_round text,
  scenario_played text,
  expected_case_type text,
  ai_detected_case_type text,
  ai_detected_secondary_types jsonb,
  detection_quality int,
  missed_domain text,
  classification_comment text,
  model_used text,
  fallback_used boolean default false,
  questions_quality int,
  report_quality int,
  safety_quality int,
  language_quality int,
  support_toolkit_quality int,
  continuation_quality int,
  repeated_questions boolean default false,
  missed_risk_flags boolean default false,
  wrong_recommendation boolean default false,
  remembered_context boolean default false,
  status text default 'new',
  short_summary text,
  main_problem text,
  expert_comment text,
  action_needed text,
  continuation_comment text,
  approved_for_learning boolean default false,
  json_data jsonb
);

create index if not exists training_sessions_created_at_idx
  on training_sessions(created_at desc);
create index if not exists training_sessions_public_code_idx
  on training_sessions(public_code);
create index if not exists training_sessions_status_idx
  on training_sessions(status);
create index if not exists training_sessions_case_type_idx
  on training_sessions(expected_case_type);
create index if not exists training_sessions_expert_id_idx
  on training_sessions(expert_id);
create index if not exists training_sessions_session_kind_idx
  on training_sessions(session_kind);
