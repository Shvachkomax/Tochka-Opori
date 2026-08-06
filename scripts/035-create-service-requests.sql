-- Service Requests: specialist follow-up system
-- Idempotent: safe to run multiple times.

create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  module text not null default 'body',
  owner_type text not null,
  owner_id uuid not null,
  session_id text,

  specialist_id text,
  specialist_name text,

  request_type text not null,
  meeting_format text,

  title text,
  message text not null,
  status text not null default 'submitted',
  priority text default 'normal',

  sla_hours integer,
  due_at timestamptz,

  reserved_credits integer default 0,
  charged_credits integer default 0,
  pricing_note text,

  context_snapshot jsonb default '{}'::jsonb,
  client_contact jsonb default '{}'::jsonb,

  specialist_response text,
  internal_note text,

  scheduled_at timestamptz,
  scheduled_place text,
  scheduled_comment text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  answered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists idx_service_requests_module
  on service_requests(module);

create index if not exists idx_service_requests_owner
  on service_requests(owner_type, owner_id);

create index if not exists idx_service_requests_specialist
  on service_requests(specialist_id);

create index if not exists idx_service_requests_status
  on service_requests(status);

create index if not exists idx_service_requests_type
  on service_requests(request_type);

create index if not exists idx_service_requests_created
  on service_requests(created_at);

create index if not exists idx_service_requests_due
  on service_requests(due_at);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
