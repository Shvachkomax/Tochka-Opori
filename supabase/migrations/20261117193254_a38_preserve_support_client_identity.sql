-- Preserve the explicit, non-clinical patient label after an invitation is
-- accepted. Canonical owner identity intentionally clears legacy public_code,
-- so the specialist list must use owner_type/owner_id and may use this label.

create or replace function public.sync_support_assignment_label_from_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_type text;
  v_owner_id uuid;
  v_expert_id uuid;
begin
  if new.status <> 'accepted'
     or new.module <> 'support'
     or nullif(pg_catalog.btrim(new.patient_label), '') is null then
    return new;
  end if;

  if new.direction = 'specialist_to_patient' then
    v_owner_type := new.target_owner_type;
    v_owner_id := new.target_owner_id;
    v_expert_id := new.inviter_expert_id;
  elsif new.direction = 'patient_to_specialist' then
    v_owner_type := new.inviter_owner_type;
    v_owner_id := new.inviter_owner_id;
    v_expert_id := new.target_expert_id;
  end if;

  if v_owner_type is null or v_owner_id is null or v_expert_id is null then
    return new;
  end if;

  update public.patient_assignments assignment
  set patient_label = coalesce(assignment.patient_label, pg_catalog.btrim(new.patient_label)),
      updated_at = pg_catalog.now()
  where assignment.status = 'active'
    and assignment.module = new.module
    and assignment.organization_id is not distinct from new.organization_id
    and assignment.primary_expert_id = v_expert_id
    and assignment.owner_type = v_owner_type
    and assignment.owner_id = v_owner_id;

  return new;
end;
$$;

revoke all on function public.sync_support_assignment_label_from_invitation()
  from public, anon, authenticated;

drop trigger if exists sync_support_assignment_label_from_invitation
  on public.patient_specialist_invitations;
create trigger sync_support_assignment_label_from_invitation
after insert or update of status, patient_label, target_owner_type, target_owner_id
on public.patient_specialist_invitations
for each row execute function public.sync_support_assignment_label_from_invitation();

with accepted_labels as (
  select distinct on (owner_type, owner_id, invitation.module, invitation.organization_id, expert_id)
    owner_type,
    owner_id,
    invitation.module,
    invitation.organization_id,
    expert_id,
    pg_catalog.btrim(invitation.patient_label) as patient_label
  from public.patient_specialist_invitations invitation
  cross join lateral (
    values (
      case invitation.direction
        when 'specialist_to_patient' then invitation.target_owner_type
        else invitation.inviter_owner_type
      end,
      case invitation.direction
        when 'specialist_to_patient' then invitation.target_owner_id
        else invitation.inviter_owner_id
      end,
      case invitation.direction
        when 'specialist_to_patient' then invitation.inviter_expert_id
        else invitation.target_expert_id
      end
    )
  ) identity(owner_type, owner_id, expert_id)
  where invitation.status = 'accepted'
    and invitation.module = 'support'
    and nullif(pg_catalog.btrim(invitation.patient_label), '') is not null
    and owner_type is not null
    and owner_id is not null
    and expert_id is not null
  order by owner_type, owner_id, invitation.module, invitation.organization_id,
           expert_id, invitation.accepted_at desc nulls last, invitation.created_at desc
)
update public.patient_assignments assignment
set patient_label = accepted_labels.patient_label,
    updated_at = pg_catalog.now()
from accepted_labels
where assignment.patient_label is null
  and assignment.status = 'active'
  and assignment.module = accepted_labels.module
  and assignment.organization_id is not distinct from accepted_labels.organization_id
  and assignment.primary_expert_id = accepted_labels.expert_id
  and assignment.owner_type = accepted_labels.owner_type
  and assignment.owner_id = accepted_labels.owner_id;

comment on function public.sync_support_assignment_label_from_invitation() is
  'Copies the explicit non-clinical patient label from an accepted Support invitation to its canonical assignment.';
