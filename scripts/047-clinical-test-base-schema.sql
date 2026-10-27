-- Minimal isolated schema for Clinical Knowledge test (not applied)
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  type text not null default 'private_clinic',
  created_at timestamptz not null default now()
);

create table if not exists experts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  role text,
  specialty text,
  city text,
  allowed_modules text[] not null default '{}',
  access_code text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists expert_organization_memberships (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references experts(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (expert_id, organization_id)
);

create table if not exists specialist_sessions (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references experts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now()
);

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

alter table clinical_knowledge_cases enable row level security;
alter table clinical_knowledge_query_log enable row level security;
alter table organizations enable row level security;
alter table experts enable row level security;
alter table expert_organization_memberships enable row level security;
alter table specialist_sessions enable row level security;

create policy "ck_cases_service_only" on clinical_knowledge_cases for all to service_role using (true) with check (true);
create policy "ck_query_log_service_only" on clinical_knowledge_query_log for all to service_role using (true) with check (true);
create policy "orgs_service_only" on organizations for all to service_role using (true) with check (true);
create policy "experts_service_only" on experts for all to service_role using (true) with check (true);
create policy "memberships_service_only" on expert_organization_memberships for all to service_role using (true) with check (true);
create policy "sessions_service_only" on specialist_sessions for all to service_role using (true) with check (true);
