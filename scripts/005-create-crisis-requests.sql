create table if not exists crisis_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  status text default 'new',
  priority text default 'urgent',

  crisis_text text,
  contact text,
  source text,
  environment text,
  public_code text,
  session_id text,

  high_risk_detected boolean default false,
  risk_markers jsonb,

  admin_comment text,
  handled_by text,
  handled_at timestamptz,

  json_data jsonb
);

create index if not exists crisis_requests_status_idx
on crisis_requests(status);

create index if not exists crisis_requests_created_at_idx
on crisis_requests(created_at desc);
