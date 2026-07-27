-- Clinical Council module ("Экспертный совет")
-- Invitations + Experts tables for SUPER_ADMIN-only council

-- Reusable updated_at trigger function (no triggers exist yet in the project)
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Invitations
create table if not exists clinical_council_invitations (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique not null,
  token_hash text unique not null,

  invited_first_name text,
  invited_last_name text,
  invited_email text,
  specialty text,
  organization text,
  invited_by text,
  notes text,

  status text not null default 'created',
  expires_at timestamptz,
  max_uses integer default 1,
  use_count integer default 0,

  opened_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cc_invitations_status_check
    check (status in ('created', 'sent', 'opened', 'accepted', 'expired', 'revoked'))
);

create index if not exists idx_cc_invitations_code on clinical_council_invitations(invite_code);
create index if not exists idx_cc_invitations_token_hash on clinical_council_invitations(token_hash);
create index if not exists idx_cc_invitations_status on clinical_council_invitations(status);
create index if not exists idx_cc_invitations_email on clinical_council_invitations(invited_email);

create trigger cc_invitations_updated_at
  before update on clinical_council_invitations
  for each row execute function update_updated_at();

comment on table clinical_council_invitations is 'Invitation links for Clinical Council experts. One-time or limited-use tokens.';
comment on column clinical_council_invitations.token_hash is 'SHA-256 hash of the raw invite token. Never stored in plaintext.';
comment on column clinical_council_invitations.invite_code is 'Public short code COUNCIL-XXXX-XXX shown in admin UI.';

-- Experts
create table if not exists clinical_council_experts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  invitation_id uuid unique references clinical_council_invitations(id) on delete set null,

  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  specialty text,
  position text,
  organization text,
  professional_note text,

  status text not null default 'pending_review',
  role text not null default 'clinical_council_expert',

  public_name_consent boolean default false,
  participation_terms_accepted_at timestamptz,

  access_token_hash text,
  access_token_generated_at timestamptz,

  approved_by text,
  approved_at timestamptz,
  rejected_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cc_experts_status_check
    check (status in ('pending_review', 'active', 'paused', 'rejected', 'revoked'))
);

create index if not exists idx_cc_experts_email on clinical_council_experts(email);
create index if not exists idx_cc_experts_status on clinical_council_experts(status);
create index if not exists idx_cc_experts_invitation on clinical_council_experts(invitation_id);
create index if not exists idx_cc_experts_access_token on clinical_council_experts(access_token_hash);

create trigger cc_experts_updated_at
  before update on clinical_council_experts
  for each row execute function update_updated_at();

comment on table clinical_council_experts is 'Approved clinical council experts. Status lifecycle: pending_review → active → paused.';
comment on column clinical_council_experts.access_token_hash is 'SHA-256 hash of the expert access token for login.';
comment on column clinical_council_experts.access_token_generated_at is 'Timestamp when the current access token was generated. Used for expiry checks.';

-- RLS (bypassed by service_role)
alter table clinical_council_invitations enable row level security;
alter table clinical_council_experts enable row level security;

create policy "cc_invitations_service_role_only" on clinical_council_invitations
  using (current_setting('role') = 'service_role');

create policy "cc_experts_service_role_only" on clinical_council_experts
  using (current_setting('role') = 'service_role');
