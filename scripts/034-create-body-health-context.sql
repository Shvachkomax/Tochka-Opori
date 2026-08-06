-- Health Context: medications, supplements, lab notes, conditions
-- One record per owner (owner_type + owner_id + module)
-- Idempotent: safe to run multiple times.

create table if not exists body_health_contexts (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null default 'anonymous_profile',
  owner_id uuid not null,
  session_id text,
  module text not null default 'body',

  health_conditions jsonb not null default '[]'::jsonb,
  medications jsonb not null default '[]'::jsonb,
  supplements jsonb not null default '[]'::jsonb,
  lab_notes jsonb not null default '{}'::jsonb,
  documents_note text,
  doctor_observation text,
  safety_flags jsonb not null default '[]'::jsonb,
  consent_acknowledged boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(owner_type, owner_id, module),

  constraint body_health_contexts_owner_check
    check (owner_type = 'anonymous_profile')
);

create index if not exists idx_health_contexts_owner
  on body_health_contexts(owner_type, owner_id);

create index if not exists idx_health_contexts_module
  on body_health_contexts(module);

create index if not exists idx_health_contexts_updated
  on body_health_contexts(updated_at);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
