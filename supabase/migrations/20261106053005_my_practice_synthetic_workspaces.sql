-- TEST/Preview ONLY. The API refuses production and accepts only synthetic data.
-- Separate from paid service_pricing, patient records and specialist service_requests.
create table if not exists public.my_practice_synthetic_workspaces (
  expert_id uuid primary key references public.experts(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  workspace jsonb not null default '{"scope":"synthetic","catalog":[],"schedule":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint my_practice_workspace_shape check (
    jsonb_typeof(workspace) = 'object'
    and workspace->>'scope' = 'synthetic'
    and jsonb_typeof(workspace->'catalog') = 'array'
    and jsonb_typeof(workspace->'schedule') = 'array'
    and pg_column_size(workspace) <= 110000
  )
);
comment on table public.my_practice_synthetic_workspaces is
  'Preview-only non-clinical test workspace. No real patients, payments or clinic agreements.';
alter table public.my_practice_synthetic_workspaces enable row level security;
revoke all on public.my_practice_synthetic_workspaces from public, anon, authenticated;
grant select,insert,update,delete on public.my_practice_synthetic_workspaces to service_role;
-- Deliberately NO policies for anon/authenticated. Server service_role + authenticated specialist session required.
