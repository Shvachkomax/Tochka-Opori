-- A3.8.1: idempotent default schedule for the TEST practice cabinet.
-- Existing availability is never changed by ensure_default_practice_availability.

create or replace function public.ensure_default_practice_availability(
  p_expert_id uuid,
  p_organization_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if p_expert_id is null or not exists (
    select 1 from public.experts where id = p_expert_id
  ) then
    raise exception 'Specialist not found' using errcode = 'P0002';
  end if;

  -- Serialize first-open initialization for one specialist/context without
  -- imposing a uniqueness rule that would prevent split working intervals.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'practice-availability:' || p_expert_id::text || ':' || coalesce(p_organization_id::text, 'private'),
      0
    )
  );

  if exists (
    select 1
      from public.practice_availability
     where expert_id = p_expert_id
       and organization_id is not distinct from p_organization_id
  ) then
    return 0;
  end if;

  insert into public.practice_availability (
    expert_id, organization_id, weekday, exception_date,
    start_time, end_time, note, is_active
  )
  select p_expert_id, p_organization_id, weekday, null,
         '09:00', '18:00', null, true
    from generate_series(1, 7) as weekday;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.reset_default_practice_availability(
  p_expert_id uuid,
  p_organization_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if p_expert_id is null or not exists (
    select 1 from public.experts where id = p_expert_id
  ) then
    raise exception 'Specialist not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'practice-availability:' || p_expert_id::text || ':' || coalesce(p_organization_id::text, 'private'),
      0
    )
  );

  update public.practice_availability
     set is_active = false
   where expert_id = p_expert_id
     and organization_id is not distinct from p_organization_id
     and is_active;

  insert into public.practice_availability (
    expert_id, organization_id, weekday, exception_date,
    start_time, end_time, note, is_active
  )
  select p_expert_id, p_organization_id, weekday, null,
         '09:00', '18:00', null, true
    from generate_series(1, 7) as weekday;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.ensure_default_practice_availability(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reset_default_practice_availability(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_default_practice_availability(uuid, uuid)
  to service_role;
grant execute on function public.reset_default_practice_availability(uuid, uuid)
  to service_role;

comment on function public.ensure_default_practice_availability(uuid, uuid) is
  'Creates seven 09:00-18:00 rows only when the specialist context has no saved availability.';
comment on function public.reset_default_practice_availability(uuid, uuid) is
  'After explicit specialist confirmation, deactivates current availability and creates the seven-row default.';
