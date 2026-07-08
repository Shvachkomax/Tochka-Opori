-- Body Intake Forms v0.1 — модуль "Опора. Здоровье & Стройность"
create table if not exists body_intake_forms (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  module text not null default 'body',
  version text not null default 'body-intake-v0.1',
  answers jsonb not null,
  bmi numeric,
  care_recommendation text,
  created_at timestamptz not null default now()
);

create index if not exists idx_body_intake_forms_session_id
on body_intake_forms(session_id);

create index if not exists idx_body_intake_forms_created_at
on body_intake_forms(created_at desc);
