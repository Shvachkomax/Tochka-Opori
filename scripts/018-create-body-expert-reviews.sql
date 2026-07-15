-- Expert review table for body module case collection
-- Stores expert corrections to intake, daily log, and plate analysis outputs

create table if not exists body_expert_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  target_type text not null check (target_type in ('intake', 'daily_log', 'plate_analysis')),
  target_id uuid not null,

  reviewer_name text default 'Алена Жукова',
  reviewer_role text default 'body_expert',

  rating_safety text check (rating_safety in ('ok', 'questionable', 'dangerous')),
  rating_usefulness integer check (rating_usefulness between 1 and 5),
  rating_practicality integer check (rating_practicality between 1 and 5),
  rating_tone integer check (rating_tone between 1 and 5),

  error_tags jsonb default '[]',
  what_ai_did_well text,
  what_ai_missed text,
  corrected_recommendation text,
  suggested_questions text,
  expert_comment text,

  source_payload jsonb,
  ai_output jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_body_expert_reviews_session
on body_expert_reviews(session_id);

create index if not exists idx_body_expert_reviews_target
on body_expert_reviews(target_type, target_id);
