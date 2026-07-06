-- v1.1.0 — Organization doctor patient access

-- ============================================================
-- 1. organizations
-- ============================================================
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  name text not null,
  slug text unique,
  type text default 'clinic',

  status text default 'active',

  city text,
  comment text,

  settings jsonb default '{}'::jsonb
);

create index if not exists organizations_status_idx on organizations(status);
create index if not exists organizations_type_idx on organizations(type);

-- ============================================================
-- 2. expert_organization_memberships
-- ============================================================
create table if not exists expert_organization_memberships (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),

  organization_id uuid references organizations(id) on delete cascade,
  expert_id uuid references experts(id) on delete cascade,

  role text default 'doctor',
  status text default 'active',

  unique (organization_id, expert_id)
);

create index if not exists eom_organization_id_idx on expert_organization_memberships(organization_id);
create index if not exists eom_expert_id_idx on expert_organization_memberships(expert_id);
create index if not exists eom_status_idx on expert_organization_memberships(status);

-- ============================================================
-- 3. patient_assignments
-- ============================================================
create table if not exists patient_assignments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  public_code text not null,

  organization_id uuid references organizations(id) on delete set null,
  primary_expert_id uuid references experts(id) on delete set null,

  assigned_by_expert_id uuid references experts(id) on delete set null,
  assigned_by_expert_name text,

  source text default 'manual',

  status text default 'active',

  patient_label text,
  comment text,

  unique(public_code, organization_id)
);

create index if not exists pa_public_code_idx on patient_assignments(public_code);
create index if not exists pa_organization_id_idx on patient_assignments(organization_id);
create index if not exists pa_primary_expert_id_idx on patient_assignments(primary_expert_id);
create index if not exists pa_status_idx on patient_assignments(status);

-- ============================================================
-- 4. patient_access
-- ============================================================
create table if not exists patient_access (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),

  public_code text not null,

  organization_id uuid references organizations(id) on delete cascade,
  expert_id uuid references experts(id) on delete cascade,

  access_role text default 'viewer',
  granted_by_expert_id uuid references experts(id) on delete set null,
  granted_by_expert_name text,

  status text default 'active',

  unique(public_code, organization_id, expert_id)
);

create index if not exists pacc_public_code_idx on patient_access(public_code);
create index if not exists pacc_organization_id_idx on patient_access(organization_id);
create index if not exists pacc_expert_id_idx on patient_access(expert_id);
create index if not exists pacc_status_idx on patient_access(status);

-- ============================================================
-- 5. doctor_invite_links
-- ============================================================
create table if not exists doctor_invite_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  expires_at timestamptz,

  token text unique not null,

  organization_id uuid references organizations(id) on delete cascade,
  expert_id uuid references experts(id) on delete cascade,

  status text default 'active',
  max_uses int,
  used_count int default 0,

  label text,
  settings jsonb default '{}'::jsonb
);

create index if not exists dil_token_idx on doctor_invite_links(token);
create index if not exists dil_organization_id_idx on doctor_invite_links(organization_id);
create index if not exists dil_expert_id_idx on doctor_invite_links(expert_id);
create index if not exists dil_status_idx on doctor_invite_links(status);

-- ============================================================
-- 6. Add columns to existing tables
-- ============================================================

-- sessions
alter table sessions
add column if not exists organization_id uuid;

alter table sessions
add column if not exists primary_expert_id uuid;

alter table sessions
add column if not exists invite_token text;

create index if not exists sessions_organization_id_idx on sessions(organization_id);
create index if not exists sessions_primary_expert_id_idx on sessions(primary_expert_id);
create index if not exists sessions_invite_token_idx on sessions(invite_token);

-- case_reviews
alter table case_reviews
add column if not exists organization_id uuid;

alter table case_reviews
add column if not exists primary_expert_id uuid;

alter table case_reviews
add column if not exists assigned_expert_id uuid;

create index if not exists case_reviews_organization_id_idx on case_reviews(organization_id);
create index if not exists case_reviews_primary_expert_id_idx on case_reviews(primary_expert_id);
create index if not exists case_reviews_assigned_expert_id_idx on case_reviews(assigned_expert_id);

-- training_sessions
alter table training_sessions
add column if not exists organization_id uuid;

alter table training_sessions
add column if not exists primary_expert_id uuid;

create index if not exists training_sessions_organization_id_idx on training_sessions(organization_id);
create index if not exists training_sessions_primary_expert_id_idx on training_sessions(primary_expert_id);
