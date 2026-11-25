-- Explicit, reversible pairing for the shared appointments cabinet.
-- Each profile keeps its original owner for bookings and all clinical data.
create table public.practice_patient_profile_links (
  support_owner_id uuid primary key,
  health_owner_id uuid not null unique,
  created_at timestamptz not null default now()
);

alter table public.practice_patient_profile_links enable row level security;
revoke all on table public.practice_patient_profile_links from public, anon, authenticated, service_role;
grant select, insert, delete on table public.practice_patient_profile_links to service_role;
