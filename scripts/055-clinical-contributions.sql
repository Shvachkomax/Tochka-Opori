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
-- Only a server-authenticated role may call this atomic review+demo bonus transaction.
create or replace function public.accept_clinical_contribution_demo(
 p_contribution_id uuid, p_reviewer_id uuid, p_comment text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v public.clinical_contributions%rowtype;
        reviewer public.experts%rowtype;
begin
 if p_comment is null or length(trim(p_comment))<8 then
   return jsonb_build_object('ok',false,'error','Заключение эксперта слишком короткое');
 end if;
 select * into reviewer from public.experts where id=p_reviewer_id and is_active=true;
 if not found or reviewer.role not in ('clinical_reviewer','platform_admin') then
   return jsonb_build_object('ok',false,'error','Нет прав рецензента');
 end if;
 select * into v from public.clinical_contributions where id=p_contribution_id for update;
 if not found then return jsonb_build_object('ok',false,'error','Наблюдение не найдено'); end if;
 if v.author_expert_id=p_reviewer_id then
   return jsonb_build_object('ok',false,'error','Нельзя принимать собственное наблюдение');
 end if;
 if v.status='accepted' then
   return jsonb_build_object('ok',true,'already_accepted',true,'points',0);
 end if;
 if v.status<>'submitted' or not v.deidentified_confirmed or not v.lawful_use_confirmed then
   return jsonb_build_object('ok',false,'error','Наблюдение не готово к экспертному принятию');
 end if;
 if reviewer.role='clinical_reviewer'
    and not (case when v.module='health' then 'body' else 'support' end = any(reviewer.allowed_modules)) then
   return jsonb_build_object('ok',false,'error','Нет прав на направление');
 end if;
 update public.clinical_contributions
 set status='accepted', reviewer_expert_id=p_reviewer_id,
     review_comment=p_comment, reviewed_at=now(),updated_at=now(), version=version+1
 where id=p_contribution_id;
 insert into public.clinical_contribution_bonus_ledger(contribution_id,expert_id)
 values (p_contribution_id,v.author_expert_id) on conflict (contribution_id) do nothing;
 return jsonb_build_object('ok',true,'points',100,'reward_mode','demo_nonredeemable');
end;
$$;
revoke all on function public.accept_clinical_contribution_demo(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_clinical_contribution_demo(uuid,uuid,text) to service_role;
