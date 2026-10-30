-- Shared Preview-Test consolidation of Clinical Knowledge contributions.
-- Port metadata schema only. Real clinical contributions, bonus credits and
-- unreviewed SECURITY DEFINER function are NOT copied or enabled.
BEGIN;
DO $check$ BEGIN
 IF to_regclass('public.clinical_contributions') IS NOT NULL
    OR to_regclass('public.clinical_contribution_bonus_ledger') IS NOT NULL
 THEN RAISE EXCEPTION 'Contribution schema exists: manual reconciliation required'; END IF;
END $check$;
-- Clinical Knowledge: de-identified clinician case contributions, isolated test only.
-- No direct patient records, legal names, dates of birth, contacts or patient IDs.
create table if not exists public.clinical_contributions (
 id uuid primary key default gen_random_uuid(),
 author_expert_id uuid not null references public.experts(id),
 organization_id uuid references public.organizations(id),
 module text not null check (module in ('support','health')),
 status text not null default 'draft' check (status in ('draft','submitted','changes_requested','accepted','rejected')),
 title text not null default '',
 age_band text not null default 'не указана' check (age_band in ('не указана','0–17','18–29','30–44','45–59','60–74','75+')),
 sex text not null default 'не указано' check (sex in ('не указано','женский','мужской','другое')),
 complaints text not null default '',
 anamnesis text not null default '',
 diagnosis text not null default '',
 examinations text not null default '',
 medications jsonb not null default '[]'::jsonb check (jsonb_typeof(medications)='array'),
 psychotherapy text not null default '',
 other_treatment text not null default '',
 outcomes text not null default '',
 adverse_events text not null default '',
 observation_period text not null default '',
 clinical_limitations text not null default '',
 deidentified_confirmed boolean not null default false,
 lawful_use_confirmed boolean not null default false,
 version integer not null default 1 check (version>0),
 submitted_at timestamptz,
 reviewed_at timestamptz,
 reviewer_expert_id uuid references public.experts(id),
 review_comment text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_clinical_contributions_author on public.clinical_contributions(author_expert_id,created_at desc);
create index if not exists idx_clinical_contributions_review on public.clinical_contributions(status,module,submitted_at);
create table if not exists public.clinical_contribution_bonus_ledger (
 id uuid primary key default gen_random_uuid(),
 contribution_id uuid not null unique references public.clinical_contributions(id),
 expert_id uuid not null references public.experts(id),
 points integer not null default 100 check (points=100),
 reward_mode text not null default 'demo_nonredeemable' check (reward_mode='demo_nonredeemable'),
 reason text not null default 'Принято обезличенное клиническое наблюдение (тестовый бонус)',
 created_at timestamptz not null default now()
);
create index if not exists idx_clinical_bonus_expert on public.clinical_contribution_bonus_ledger(expert_id,created_at desc);
alter table public.clinical_contributions enable row level security;
alter table public.clinical_contribution_bonus_ledger enable row level security;
revoke all on public.clinical_contributions from public,anon,authenticated;
revoke all on public.clinical_contribution_bonus_ledger from public,anon,authenticated;
grant select,insert,update on public.clinical_contributions to service_role;
grant select,insert on public.clinical_contribution_bonus_ledger to service_role;
COMMENT ON TABLE public.clinical_contributions IS
 'Private clinician-submitted deidentified case candidates; not patient records; feature disabled by default.';
COMMENT ON TABLE public.clinical_contribution_bonus_ledger IS
 'Only nonredeemable demo credits; no payment or cash liability.';
COMMIT;
