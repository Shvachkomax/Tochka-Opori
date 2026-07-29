-- Clinical Council soft delete + position field
-- Adds deleted_at/deleted_by for trash functionality
-- Adds position column to invitations (for auto-fill)

alter table clinical_council_invitations
  add column if not exists position text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

alter table clinical_council_experts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

-- Indexes for trash queries
create index if not exists idx_cc_invitations_deleted on clinical_council_invitations(deleted_at);
create index if not exists idx_cc_experts_deleted on clinical_council_experts(deleted_at);
