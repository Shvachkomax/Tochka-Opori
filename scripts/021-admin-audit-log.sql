-- Security Pass 2 — Admin Audit Log
-- Tracks admin actions for accountability.
-- Does NOT store tokens, secrets, or full payloads.

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  performed_at timestamptz not null default now(),
  admin_role text not null,
  action text not null,
  target_type text,
  target_id text,
  module text,
  ip_address text,
  success boolean not null default true,
  details jsonb default '{}'
);

create index if not exists idx_admin_audit_log_performed
  on admin_audit_log(performed_at desc);

create index if not exists idx_admin_audit_log_action
  on admin_audit_log(action);

create index if not exists idx_admin_audit_log_admin
  on admin_audit_log(admin_role);

comment on table admin_audit_log is 'Tracks admin actions: login, export, delete, restore, expert review, specialist note';
comment on column admin_audit_log.details is 'Non-sensitive metadata (counts, types, etc). Never store tokens or full payloads.';
