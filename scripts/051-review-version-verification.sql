alter table published_clinical_cases
  add column if not exists version text not null default '1';

alter table published_clinical_cases
  add column if not exists source_verified boolean not null default false;

alter table published_clinical_cases
  add column if not exists rights_verified boolean not null default false;

update published_clinical_cases
set expert_review_status = 'rejected'
where title = 'Incomplete Pub'
  and expert_review_status = 'approved';

create or replace function approve_published_case(
  p_reviewer_id uuid,
  p_publication_id text,
  p_version text,
  p_comment text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case published_clinical_cases%rowtype;
  v_existing uuid;
  v_updated integer;
begin
  if p_idempotency_key is not null then
    select id into v_existing from clinical_review_log
    where publication_id = p_publication_id and idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'idempotent', true);
    end if;
  end if;

  select * into v_case
  from published_clinical_cases
  where id::text = p_publication_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'publication not found');
  end if;

  if not exists (select 1 from experts where id = p_reviewer_id and role = 'clinical_reviewer' and is_active = true) then
    return jsonb_build_object('ok', false, 'error', 'reviewer not authorized');
  end if;

  if v_case.submitted_by_expert_id is not null and v_case.submitted_by_expert_id = p_reviewer_id then
    return jsonb_build_object('ok', false, 'error', 'self approval forbidden');
  end if;

  if v_case.expert_review_status <> 'pending_review' then
    return jsonb_build_object('ok', false, 'error', 'publication is not pending review');
  end if;

  if p_version is not null and v_case.version <> p_version then
    return jsonb_build_object('ok', false, 'error', 'stale version');
  end if;

  if not v_case.source_verified or not v_case.rights_verified then
    return jsonb_build_object('ok', false, 'error', 'required metadata not verified');
  end if;

  insert into clinical_review_log (reviewer_id, publication_id, publication_version, decision, comment, idempotency_key)
  values (p_reviewer_id, p_publication_id, p_version, 'approve', p_comment, p_idempotency_key);

  update published_clinical_cases
  set expert_review_status = 'approved', updated_at = now()
  where id::text = p_publication_id
    and expert_review_status = 'pending_review'
    and version = v_case.version;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'publication status was changed concurrently');
  end if;

  return jsonb_build_object('ok', true, 'idempotent', false);
end;
$$;

revoke all on function approve_published_case(uuid, text, text, text, text) from public;
revoke all on function approve_published_case(uuid, text, text, text, text) from anon;
revoke all on function approve_published_case(uuid, text, text, text, text) from authenticated;
grant execute on function approve_published_case(uuid, text, text, text, text) to service_role;
