-- Clinical Council Email Campaigns
-- Migration 025: email campaigns + delivery tracking

-- Email campaigns table
create table if not exists clinical_council_email_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body_text text not null,
  recipient_filter jsonb,
  status text not null default 'draft',
  created_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  total_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  constraint cc_email_campaigns_status_check
    check (status in ('draft', 'sending', 'completed', 'partially_failed', 'failed', 'cancelled'))
);

-- Email delivery tracking table
create table if not exists clinical_council_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references clinical_council_email_campaigns(id) on delete cascade,
  expert_id uuid references clinical_council_experts(id) on delete set null,
  invitation_id uuid references clinical_council_invitations(id) on delete set null,
  recipient_email text not null,
  recipient_name text,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cc_email_deliveries_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped'))
);

-- Indexes
create index if not exists idx_cc_email_campaigns_status on clinical_council_email_campaigns(status);
create index if not exists idx_cc_email_campaigns_created on clinical_council_email_campaigns(created_at desc);
create index if not exists idx_cc_email_deliveries_campaign on clinical_council_email_deliveries(campaign_id);
create index if not exists idx_cc_email_deliveries_status on clinical_council_email_deliveries(status);

-- RLS: only service_role
alter table clinical_council_email_campaigns enable row level security;
alter table clinical_council_email_deliveries enable row level security;

create policy "cc_email_campaigns_service_role_only" on clinical_council_email_campaigns
  using (current_setting('role') = 'service_role');

create policy "cc_email_deliveries_service_role_only" on clinical_council_email_deliveries
  using (current_setting('role') = 'service_role');
