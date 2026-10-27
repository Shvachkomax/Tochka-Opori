create table if not exists published_clinical_cases (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  authors text,
  journal text,
  year integer,
  doi text,
  source_url text not null,
  specialty text,
  symptoms text[] not null default '{}',
  diagnosis text,
  examinations text[] not null default '{}',
  treatment text,
  outcomes text,
  applicability_limits text,
  usage_rights text,
  expert_review_status text not null default 'draft',
  last_verified_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_published_case_status check (expert_review_status in ('draft','pending_review','approved','rejected','archived'))
);
alter table published_clinical_cases enable row level security;
create policy "published_cases_service_only" on published_clinical_cases for all to service_role using (true) with check (true);
