-- Body clients registry for "Опора. Здоровье & Стройность"
-- Tracks client source, specialist referral, and status

-- Add source columns to body_intake_forms for easy admin querying
alter table body_intake_forms
add column if not exists source text default 'self_signup';

alter table body_intake_forms
add column if not exists specialist_id text;

alter table body_intake_forms
add column if not exists specialist_name text;

-- Create body_clients table (normalized registry)
create table if not exists body_clients (
  id uuid primary key default gen_random_uuid(),
  session_id text unique not null,
  display_name text,
  source text not null default 'self_signup',
  specialist_id text,
  specialist_name text,
  referral_code text,
  status text not null default 'active',
  goal text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_body_clients_session_id
on body_clients(session_id);

create index if not exists idx_body_clients_source
on body_clients(source);

create index if not exists idx_body_clients_specialist_id
on body_clients(specialist_id);
