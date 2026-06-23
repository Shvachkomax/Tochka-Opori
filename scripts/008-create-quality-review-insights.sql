create table if not exists quality_review_insights (
  id uuid primary key default gen_random_uuid(),

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  created_by_expert_id uuid,
  created_by_expert_name text,

  analysis_type text default 'new_approved',
  status text default 'new',

  review_count int default 0,
  review_ids jsonb default '[]'::jsonb,

  date_from timestamptz,
  date_to timestamptz,

  model_used text,
  fallback_used boolean default false,

  summary text,
  strengths jsonb default '[]'::jsonb,
  recurring_problems jsonb default '[]'::jsonb,
  safety_findings jsonb default '[]'::jsonb,
  language_findings jsonb default '[]'::jsonb,
  missed_domains jsonb default '[]'::jsonb,
  recommendations jsonb default '[]'::jsonb,

  proposed_prompt_changes jsonb default '[]'::jsonb,
  proposed_logic_changes jsonb default '[]'::jsonb,
  regression_tests jsonb default '[]'::jsonb,

  risk_of_changes text,
  admin_comment text,

  reviewed_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,

  json_data jsonb
);

create index if not exists quality_review_insights_created_at_idx
on quality_review_insights(created_at desc);

create index if not exists quality_review_insights_status_idx
on quality_review_insights(status);

alter table case_reviews
add column if not exists quality_analysis_id uuid;

alter table case_reviews
add column if not exists quality_analyzed_at timestamptz;
