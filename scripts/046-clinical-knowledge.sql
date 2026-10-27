-- Clinical Knowledge foundation (not applied to production)
create table if not exists clinical_knowledge_cases (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  age_group text,
  complaints text[] not null default '{}',
  anamnesis text,
  comorbidities text[] not null default '{}',
  examinations text[] not null default '{}',
  confirmed_diagnosis text,
  treatment text,
  outcomes text,
  adverse_reactions text[] not null default '{}',
  observation_duration text,
  source text not null,
  usage_rights text not null,
  expert_review_status text not null default 'draft',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint chk_ck_case_status check (expert_review_status in ('draft','pending_review','approved','rejected','archived'))
);

create table if not exists clinical_knowledge_query_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  organization_id uuid,
  operation text not null,
  result_count integer not null default 0,
  idempotency_key text,
  price_rub bigint not null default 0,
  billing_enabled boolean not null default false,
  charged boolean not null default false,
  status text not null default 'success',
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint uq_ck_query_idempotency unique (idempotency_key)
);

create index if not exists idx_ck_cases_status on clinical_knowledge_cases(expert_review_status);
create index if not exists idx_ck_query_actor on clinical_knowledge_query_log(actor_id, created_at desc);

-- RLS
alter table clinical_knowledge_cases enable row level security;
alter table clinical_knowledge_query_log enable row level security;

-- Default deny for anon/authenticated; server uses service role.
create policy "ck_cases_service_only" on clinical_knowledge_cases
  for all to service_role using (true) with check (true);
create policy "ck_query_log_service_only" on clinical_knowledge_query_log
  for all to service_role using (true) with check (true);
