-- A3.8: one canonical patient-specialist relationship model.
--
-- patient_assignments contains at most one primary specialist for an owner,
-- organization and module. patient_access contains additional specialists only.
-- Readers use the deduplicated union of both tables. Exact assignment/access
-- duplicates are deactivated because the primary assignment already grants access.

update public.patient_access access_row
set status = 'revoked'
where access_row.status = 'active'
  and exists (
    select 1
    from public.patient_assignments assignment
    where assignment.status = 'active'
      and assignment.module = access_row.module
      and assignment.organization_id is not distinct from access_row.organization_id
      and assignment.primary_expert_id = access_row.expert_id
      and (
        (assignment.owner_id is not null
          and assignment.owner_type = access_row.owner_type
          and assignment.owner_id = access_row.owner_id)
        or (assignment.public_code is not null
          and assignment.public_code = access_row.public_code)
      )
  );

create or replace function public.accept_specialist_invitation(
  p_token_hash text,
  p_owner_id uuid,
  p_public_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation record;
  v_expert record;
  v_primary record;
  v_additional record;
  v_expert_id uuid;
  v_owner_type text;
  v_now timestamptz := pg_catalog.now();
begin
  select id, direction, module, target_owner_type, target_owner_id,
         target_expert_id, inviter_owner_type, inviter_owner_id,
         inviter_expert_id, organization_id, status, expires_at
  into v_invitation
  from public.patient_specialist_invitations
  where token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Приглашение не найдено', 'code', 'NOT_FOUND');
  end if;
  if v_invitation.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Приглашение уже обработано', 'code', 'ALREADY_PROCESSED');
  end if;
  if v_invitation.expires_at < v_now then
    return jsonb_build_object('ok', false, 'error', 'Приглашение истекло', 'code', 'EXPIRED');
  end if;

  v_owner_type := case v_invitation.module
    when 'support' then 'anonymous_case'
    when 'body' then 'anonymous_profile'
    else null
  end;
  if v_owner_type is null then
    return jsonb_build_object('ok', false, 'error', 'Несоответствие модуля', 'code', 'MODULE_MISMATCH');
  end if;
  if v_invitation.module = 'support' and nullif(pg_catalog.btrim(p_public_code), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Не найдена Support-сессия пациента', 'code', 'OWNER_MISMATCH');
  end if;

  if v_invitation.direction = 'specialist_to_patient' then
    if v_invitation.target_owner_id is not null
       and (v_invitation.target_owner_id <> p_owner_id
         or v_invitation.target_owner_type is distinct from v_owner_type) then
      return jsonb_build_object('ok', false, 'error', 'Доступ запрещён', 'code', 'FORBIDDEN');
    end if;
    v_expert_id := v_invitation.inviter_expert_id;
  elsif v_invitation.direction = 'patient_to_specialist' then
    if v_invitation.inviter_owner_type is distinct from v_owner_type
       or v_invitation.inviter_owner_id is distinct from p_owner_id then
      return jsonb_build_object('ok', false, 'error', 'Доступ запрещён', 'code', 'OWNER_MISMATCH');
    end if;
    v_expert_id := v_invitation.target_expert_id;
  else
    return jsonb_build_object('ok', false, 'error', 'Некорректное приглашение', 'code', 'INVALID_DIRECTION');
  end if;

  if v_expert_id is null then
    return jsonb_build_object('ok', false, 'error', 'Специалист ещё не подключён', 'code', 'EXPERT_UNAVAILABLE');
  end if;

  select id, is_active, allowed_modules
  into v_expert
  from public.experts
  where id = v_expert_id;
  if not found or not v_expert.is_active then
    return jsonb_build_object('ok', false, 'error', 'Специалист недоступен', 'code', 'EXPERT_UNAVAILABLE');
  end if;
  if not coalesce(v_expert.allowed_modules @> array[v_invitation.module]::text[], false) then
    return jsonb_build_object('ok', false, 'error', 'Специалист не имеет доступа к данному модулю', 'code', 'NO_MODULE_ENTITLEMENT');
  end if;
  if v_invitation.organization_id is not null and not exists (
    select 1 from public.expert_organization_memberships membership
    where membership.expert_id = v_expert_id
      and membership.organization_id = v_invitation.organization_id
      and membership.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Специалист не состоит в этой организации', 'code', 'ORGANIZATION_MISMATCH');
  end if;

  select id, primary_expert_id
  into v_primary
  from public.patient_assignments
  where module = v_invitation.module
    and status = 'active'
    and organization_id is not distinct from v_invitation.organization_id
    and (
      (owner_type = v_owner_type and owner_id = p_owner_id)
      or (v_invitation.module = 'support' and public_code = p_public_code)
    )
  order by created_at desc
  limit 1
  for update;

  if found and v_primary.primary_expert_id <> v_expert_id then
    select id into v_additional
    from public.patient_access
    where module = v_invitation.module
      and status = 'active'
      and organization_id is not distinct from v_invitation.organization_id
      and expert_id = v_expert_id
      and (
        (owner_type = v_owner_type and owner_id = p_owner_id)
        or (v_invitation.module = 'support' and public_code = p_public_code)
      )
    order by created_at desc
    limit 1
    for update;

    if not found then
      insert into public.patient_access (
        public_code, owner_type, owner_id, organization_id, expert_id,
        access_role, granted_by_expert_id, granted_by_expert_name, module, status
      ) values (
        case when v_invitation.module = 'support' then p_public_code else null end,
        v_owner_type, p_owner_id, v_invitation.organization_id, v_expert_id,
        'clinician', v_expert_id, 'invitation', v_invitation.module, 'active'
      );
    end if;
  elsif found then
    -- A primary assignment is sufficient; remove an old exact compatibility row.
    update public.patient_access
    set status = 'revoked'
    where status = 'active'
      and module = v_invitation.module
      and organization_id is not distinct from v_invitation.organization_id
      and expert_id = v_expert_id
      and (
        (owner_type = v_owner_type and owner_id = p_owner_id)
        or (v_invitation.module = 'support' and public_code = p_public_code)
      );
  else
    insert into public.patient_assignments (
      public_code, owner_type, owner_id, organization_id, primary_expert_id,
      assigned_by_expert_id, assigned_by_expert_name, module, status, source
    ) values (
      case when v_invitation.module = 'support' then p_public_code else null end,
      v_owner_type, p_owner_id, v_invitation.organization_id, v_expert_id,
      v_expert_id, 'invitation', v_invitation.module, 'active',
      'patient_invitation_accept'
    );

    update public.patient_access
    set status = 'revoked'
    where status = 'active'
      and module = v_invitation.module
      and organization_id is not distinct from v_invitation.organization_id
      and expert_id = v_expert_id
      and (
        (owner_type = v_owner_type and owner_id = p_owner_id)
        or (v_invitation.module = 'support' and public_code = p_public_code)
      );
  end if;

  update public.patient_specialist_invitations
  set status = 'accepted',
      accepted_at = v_now,
      target_owner_id = case when direction = 'specialist_to_patient' then p_owner_id else target_owner_id end,
      target_owner_type = case when direction = 'specialist_to_patient' then v_owner_type else target_owner_type end,
      updated_at = v_now
  where id = v_invitation.id and status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'message', case when v_primary.id is null then 'Специалист назначен' else 'Специалист подключён' end,
    'relationship', case when v_primary.id is null or v_primary.primary_expert_id = v_expert_id then 'primary' else 'shared' end
  );
end;
$$;

revoke all on function public.accept_specialist_invitation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_specialist_invitation(text, uuid, text) to service_role;

comment on function public.accept_specialist_invitation(text, uuid, text) is
  'Accepts a Support or Health invitation atomically. Creates one primary assignment or one additional access row without duplicates.';

create or replace function public.revoke_patient_specialist_link(
  p_owner_type text,
  p_owner_id uuid,
  p_public_code text,
  p_module text,
  p_expert_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_assignment_count integer := 0;
  v_access_count integer := 0;
begin
  if not (p_module = any (array['support', 'body']))
     or p_owner_type is distinct from (case p_module when 'support' then 'anonymous_case' else 'anonymous_profile' end)
     or p_owner_id is null
     or p_expert_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LINK', 'error', 'Некорректная связь');
  end if;

  update public.patient_assignments
  set status = 'revoked', updated_at = v_now
  where status = 'active'
    and module = p_module
    and organization_id is not distinct from p_organization_id
    and primary_expert_id = p_expert_id
    and (
      (owner_type = p_owner_type and owner_id = p_owner_id)
      or (p_module = 'support' and public_code = p_public_code)
    );
  get diagnostics v_assignment_count = row_count;

  update public.patient_access
  set status = 'revoked'
  where status = 'active'
    and module = p_module
    and organization_id is not distinct from p_organization_id
    and expert_id = p_expert_id
    and (
      (owner_type = p_owner_type and owner_id = p_owner_id)
      or (p_module = 'support' and public_code = p_public_code)
    );
  get diagnostics v_access_count = row_count;

  update public.patient_specialist_invitations
  set status = 'revoked', revoked_at = v_now, updated_at = v_now
  where status = 'accepted'
    and module = p_module
    and organization_id is not distinct from p_organization_id
    and (
      (inviter_expert_id = p_expert_id and target_owner_type = p_owner_type and target_owner_id = p_owner_id)
      or (target_expert_id = p_expert_id and inviter_owner_type = p_owner_type and inviter_owner_id = p_owner_id)
    );

  return jsonb_build_object(
    'ok', true,
    'revoked', v_assignment_count + v_access_count,
    'idempotent', v_assignment_count + v_access_count = 0
  );
end;
$$;

revoke all on function public.revoke_patient_specialist_link(text, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_patient_specialist_link(text, uuid, text, text, uuid, uuid) to service_role;

comment on function public.revoke_patient_specialist_link(text, uuid, text, text, uuid, uuid) is
  'Revokes exactly one patient-specialist link in one organization and module. Caller identity is verified by the server API.';
