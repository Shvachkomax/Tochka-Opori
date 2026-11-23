-- R2.3.2-L-Mac LOCAL REHEARSAL ONLY.
--
-- Aligns an empty database built from the 33 Git files corresponding to the
-- Production migration history with read-only Production catalog metadata
-- captured on 2026-11-23. This is not a deployable migration and must never be
-- applied to Test or Production.

do $local_rehearsal_guard$
begin
  if current_setting('r232.local_rehearsal', true) is distinct from 'on' then
    raise exception
      'LOCAL REHEARSAL ONLY: set r232.local_rehearsal=on explicitly for this isolated session';
  end if;
end;
$local_rehearsal_guard$;

begin;

-- Historical column/default drift confirmed from pg_attribute/pg_attrdef.
alter table public.body_ai_chat
  alter column owner_type set default 'anonymous_profile'::text;

alter table public.body_expert_reviews
  alter column session_id set not null,
  alter column reviewer_name set default 'Алена Жукова'::text,
  alter column reviewer_role set default 'body_expert'::text,
  alter column error_tags set default '[]'::jsonb;

alter table public.body_weekly_summaries
  alter column summary_json set not null;

-- Rebuild this empty local-only baseline table to preserve the exact
-- Production column set and ordinal order. The delivery table is retained.
alter table public.clinical_council_email_deliveries
  drop constraint if exists clinical_council_email_deliveries_campaign_id_fkey;

drop table public.clinical_council_email_campaigns;

create table public.clinical_council_email_campaigns (
  id uuid default gen_random_uuid() not null,
  subject text not null,
  body_text text not null,
  recipient_filter jsonb,
  status text default 'draft'::text not null,
  created_by text,
  created_at timestamptz default now() not null,
  started_at timestamptz,
  completed_at timestamptz,
  total_count integer default 0 not null,
  sent_count integer default 0 not null,
  failed_count integer default 0 not null,
  constraint clinical_council_email_campaigns_pkey primary key (id),
  constraint cc_email_campaigns_status_check check (
    status = any (array[
      'draft'::text,
      'sending'::text,
      'completed'::text,
      'partially_failed'::text,
      'failed'::text,
      'cancelled'::text
    ])
  )
);

create index idx_cc_email_campaigns_created
  on public.clinical_council_email_campaigns using btree (created_at desc);
create index idx_cc_email_campaigns_status
  on public.clinical_council_email_campaigns using btree (status);

alter table public.clinical_council_email_campaigns enable row level security;

create policy cc_email_campaigns_service_role_only
  on public.clinical_council_email_campaigns
  using ((select current_setting('role'::text)) = 'service_role'::text);

grant all on table public.clinical_council_email_campaigns
  to anon, authenticated, service_role;

alter table public.clinical_council_email_deliveries
  add constraint clinical_council_email_deliveries_campaign_id_fkey
  foreign key (campaign_id)
  references public.clinical_council_email_campaigns(id)
  on delete cascade;

-- Constraint names and definitions are part of the confirmed baseline.
alter table public.body_ai_chat
  add constraint body_ai_chat_owner_check
  check (owner_type = 'anonymous_profile'::text);

alter table public.body_expert_reviews
  drop constraint if exists body_expert_reviews_rating_safety_check,
  add constraint body_expert_reviews_rating_safety_check
    check (rating_safety = any (array['ok'::text, 'questionable'::text, 'dangerous'::text])),
  add constraint body_expert_reviews_rating_usefulness_check
    check (rating_usefulness >= 1 and rating_usefulness <= 5),
  add constraint body_expert_reviews_rating_practicality_check
    check (rating_practicality >= 1 and rating_practicality <= 5),
  add constraint body_expert_reviews_rating_tone_check
    check (rating_tone >= 1 and rating_tone <= 5);

alter table public.body_health_contexts
  rename constraint body_health_contexts_owner_type_check
  to body_health_contexts_owner_check;

alter table public.body_insights
  rename constraint body_insights_owner_type_check
  to body_insights_owner_check;
alter table public.body_insights
  rename constraint body_insights_insight_type_check
  to body_insights_type_check;

alter table public.body_onboarding
  rename constraint body_onboarding_owner_type_check
  to body_onboarding_owner_check;

alter table public.body_plate_history
  rename constraint body_plate_history_owner_type_check
  to body_plate_history_owner_check;

alter table public.body_weekly_summaries
  rename constraint body_weekly_summaries_owner_type_check
  to body_weekly_summaries_owner_check;
alter table public.body_weekly_summaries
  rename constraint body_weekly_summaries_summary_type_check
  to body_weekly_summaries_type_check;

-- Production-only historical FK set missing from the current Git baseline.
alter table public.clinical_council_email_deliveries
  add constraint clinical_council_email_deliveries_expert_id_fkey
    foreign key (expert_id) references public.clinical_council_experts(id) on delete set null,
  add constraint clinical_council_email_deliveries_invitation_id_fkey
    foreign key (invitation_id) references public.clinical_council_invitations(id) on delete set null;

alter table public.clinical_council_experts
  add constraint clinical_council_experts_invitation_id_fkey
  foreign key (invitation_id)
  references public.clinical_council_invitations(id)
  on delete set null;

alter table public.doctor_invite_links
  add constraint doctor_invite_links_expert_id_fkey
    foreign key (expert_id) references public.experts(id) on delete cascade,
  add constraint doctor_invite_links_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.expert_organization_memberships
  add constraint expert_organization_memberships_expert_id_fkey
    foreign key (expert_id) references public.experts(id) on delete cascade,
  add constraint expert_organization_memberships_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.patient_access
  add constraint patient_access_expert_id_fkey
    foreign key (expert_id) references public.experts(id) on delete cascade,
  add constraint patient_access_granted_by_expert_id_fkey
    foreign key (granted_by_expert_id) references public.experts(id) on delete set null,
  add constraint patient_access_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.patient_assignments
  add constraint patient_assignments_assigned_by_expert_id_fkey
    foreign key (assigned_by_expert_id) references public.experts(id) on delete set null,
  add constraint patient_assignments_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete set null,
  add constraint patient_assignments_primary_expert_id_fkey
    foreign key (primary_expert_id) references public.experts(id) on delete set null;

alter table public.specialist_sessions
  add constraint specialist_sessions_expert_id_fkey
  foreign key (expert_id)
  references public.experts(id)
  on delete cascade;

-- Exact Production function bodies from pg_get_functiondef(). These replace
-- Git-history variants only inside the isolated local baseline.
create or replace function public.clear_continuation_failed_attempts(p_attempt_key text)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  delete from continuation_failed_attempts where attempt_key = p_attempt_key;
end;
$function$;

create or replace function public.increment_continuation_failed_attempts(p_attempt_key text)
returns table(failed_attempt_count integer, locked_until timestamptz)
language plpgsql
set search_path to ''
as $function$
begin
  return query
  insert into continuation_failed_attempts (attempt_key, failed_attempt_count, locked_until, updated_at)
  values (p_attempt_key, 1, null, now())
  on conflict (attempt_key)
  do update set
    failed_attempt_count = continuation_failed_attempts.failed_attempt_count + 1,
    locked_until = case
      when continuation_failed_attempts.failed_attempt_count + 1 >= 5 then now() + interval '15 minutes'
      else null
    end,
    updated_at = now()
  returning continuation_failed_attempts.failed_attempt_count, continuation_failed_attempts.locked_until;
end;
$function$;

create or replace function public.enforce_patient_access_identity()
returns trigger
language plpgsql
set search_path to ''
as $function$
BEGIN
  IF (NEW.owner_type IS NULL) <> (NEW.owner_id IS NULL) THEN
    RAISE EXCEPTION 'owner_type and owner_id must both be provided or both be NULL';
  END IF;
  IF NEW.public_code IS NULL AND NEW.owner_type IS NULL THEN
    RAISE EXCEPTION 'Row must have either public_code or owner identity (owner_type + owner_id)';
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.enforce_patient_assignment_identity()
returns trigger
language plpgsql
set search_path to ''
as $function$
BEGIN
  IF (NEW.owner_type IS NULL) <> (NEW.owner_id IS NULL) THEN
    RAISE EXCEPTION 'owner_type and owner_id must both be provided or both be NULL';
  END IF;
  IF NEW.public_code IS NULL AND NEW.owner_type IS NULL THEN
    RAISE EXCEPTION 'Row must have either public_code or owner identity (owner_type + owner_id)';
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.trigger_set_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.update_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

create or replace function public.consume_usage_credits(
  p_wallet_id uuid,
  p_amount bigint,
  p_request_id text,
  p_resource_type text default null::text,
  p_module text default 'support'::text,
  p_session_id text default null::text,
  p_provider text default null::text,
  p_model text default null::text,
  p_input_tokens integer default null::integer,
  p_output_tokens integer default null::integer,
  p_audio_seconds integer default null::integer,
  p_image_count integer default null::integer,
  p_estimated_cost numeric default null::numeric,
  p_metadata jsonb default null::jsonb
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_wallet public.usage_wallets%rowtype;
  v_balance_before bigint;
  v_remaining bigint;
  v_charged bigint := 0;
  v_refill_count integer := 0;
  v_existing record;
begin
  -- Idempotency check
  select id, entry_type, amount, balance_before, balance_after
  into v_existing
  from public.usage_ledger
  where request_id = p_request_id
  limit 1;

  if found then
    return jsonb_build_object(
      'balance_before', v_existing.balance_before,
      'charged', v_existing.amount,
      'balance_after', v_existing.balance_after,
      'refill_count', 0,
      'cycle_number', 0,
      'total_used', 0,
      'idempotent_replay', true
    );
  end if;

  if p_amount <= 0 then
    return jsonb_build_object(
      'balance_before', 0,
      'charged', 0,
      'balance_after', 0,
      'refill_count', 0,
      'cycle_number', 0,
      'total_used', 0,
      'idempotent_replay', false
    );
  end if;

  -- Lock wallet row
  select * into v_wallet
  from public.usage_wallets
  where id = p_wallet_id
  for update;

  if not found then
    raise exception 'Wallet not found: %', p_wallet_id;
  end if;

  if v_wallet.status = 'paused' or v_wallet.status = 'closed' then
    raise exception 'Wallet is %', v_wallet.status;
  end if;

  v_balance_before := v_wallet.balance;
  v_remaining := v_wallet.balance;

  -- Main loop: debit, refill on zero, repeat until fully charged
  while p_amount > v_charged loop
    if v_remaining = 0 then
      if v_wallet.refill_mode = 'on_zero' then
        v_remaining := v_wallet.refill_amount;
        v_refill_count := v_refill_count + 1;
        v_wallet.cycle_number := v_wallet.cycle_number + 1;
        v_wallet.total_refilled := v_wallet.total_refilled + v_wallet.refill_amount;

        insert into public.usage_ledger (
          wallet_id, entry_type, amount, balance_before, balance_after,
          resource_type, request_id, module, session_id,
          provider, model, input_tokens, output_tokens, audio_seconds, image_count,
          estimated_cost, metadata
        ) values (
          p_wallet_id, 'automatic_refill', v_wallet.refill_amount, v_balance_before, v_remaining,
          null, p_request_id || '-refill-' || v_refill_count,
          p_module, null, null, null,
          null, null, null, null,
          null, jsonb_build_object('refill_reason', 'on_zero', 'cycle', v_wallet.cycle_number)
        );
      else
        raise exception 'Insufficient credits and refill_mode is not on_zero';
      end if;
    end if;

    if v_remaining > 0 then
      declare
        v_debit bigint;
        v_after bigint;
        v_req_id text;
      begin
        v_debit := least(p_amount - v_charged, v_remaining);
        v_after := v_remaining - v_debit;

        if v_refill_count = 0 then
          v_req_id := p_request_id;
        else
          v_req_id := p_request_id || '-r' || v_refill_count || '-' || v_charged;
        end if;

        insert into public.usage_ledger (
          wallet_id, entry_type, amount, balance_before, balance_after,
          resource_type, request_id, module, session_id,
          provider, model, input_tokens, output_tokens, audio_seconds, image_count,
          estimated_cost, metadata
        ) values (
          p_wallet_id, 'usage_debit', v_debit, v_remaining, v_after,
          p_resource_type, v_req_id,
          p_module, p_session_id, p_provider, p_model,
          p_input_tokens, p_output_tokens, p_audio_seconds, p_image_count,
          p_estimated_cost, p_metadata
        );

        v_remaining := v_after;
        v_charged := v_charged + v_debit;
      end;
    end if;
  end loop;

  -- Final wallet update
  update public.usage_wallets set
    balance = v_remaining,
    cycle_number = v_wallet.cycle_number,
    total_used = total_used + v_charged,
    total_refilled = v_wallet.total_refilled
  where id = p_wallet_id;

  return jsonb_build_object(
    'balance_before', v_balance_before,
    'charged', v_charged,
    'balance_after', v_remaining,
    'refill_count', v_refill_count,
    'cycle_number', v_wallet.cycle_number,
    'total_used', (select total_used from public.usage_wallets where id = p_wallet_id),
    'idempotent_replay', false
  );
end;
$function$;

create or replace function public.reassign_body_client(
  p_owner_id uuid,
  p_new_expert_id uuid,
  p_organization_id uuid default null::uuid
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
DECLARE
  v_old_assignment_id uuid;
  v_new_assignment_id uuid;
  v_current_expert uuid;
BEGIN
  -- 1. Validate new expert exists and is active
  IF NOT EXISTS (
    SELECT 1 FROM public.experts
    WHERE id = p_new_expert_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Специалист не найден или неактивен');
  END IF;

  -- 2. Validate organization membership if org specified
  IF p_organization_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.expert_organization_memberships
      WHERE expert_id = p_new_expert_id
        AND organization_id = p_organization_id
        AND status = 'active'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Специалист не состоит в указанной организации');
    END IF;
  END IF;

  -- 3. Find current active assignment (lock row for update)
  SELECT id INTO v_old_assignment_id
  FROM public.patient_assignments
  WHERE owner_type = 'anonymous_profile'
    AND owner_id = p_owner_id
    AND module = 'body'
    AND organization_id IS NOT DISTINCT FROM p_organization_id
    AND status = 'active'
  FOR UPDATE;

  -- 4. If same expert already assigned, return noop
  IF v_old_assignment_id IS NOT NULL THEN
    SELECT primary_expert_id INTO v_current_expert
    FROM public.patient_assignments WHERE id = v_old_assignment_id;
    IF v_current_expert = p_new_expert_id THEN
      RETURN jsonb_build_object('ok', true, 'noop', true, 'message', 'Уже назначено', 'assignment_id', v_old_assignment_id);
    END IF;
  END IF;

  -- 5. Deactivate old assignment if exists
  IF v_old_assignment_id IS NOT NULL THEN
    UPDATE public.patient_assignments
    SET status = 'reassigned', updated_at = now()
    WHERE id = v_old_assignment_id;
  END IF;

  -- 6. Create new assignment
  INSERT INTO public.patient_assignments (
    public_code, owner_type, owner_id, organization_id,
    primary_expert_id, assigned_by_expert_id, assigned_by_expert_name,
    source, status, module
  ) VALUES (
    NULL, 'anonymous_profile', p_owner_id, p_organization_id,
    p_new_expert_id, NULL, 'admin',
    'admin_body_reassignment', 'active', 'body'
  ) RETURNING id INTO v_new_assignment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'assignment_id', v_new_assignment_id,
    'old_assignment_id', v_old_assignment_id
  );
END;
$function$;

commit;
