\set ON_ERROR_STOP on

begin;

do $contract$
declare
  v_increment oid := to_regprocedure(
    'public.increment_continuation_failed_attempts(text)'
  );
  v_clear oid := to_regprocedure(
    'public.clear_continuation_failed_attempts(text)'
  );
  v_acl_roles text[];
begin
  if v_increment is null or v_clear is null then
    raise exception 'Continuation failed-attempt RPC is missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc
    where oid in (v_increment, v_clear)
      and (
        pg_get_userbyid(proowner) <> 'postgres'
        or prosecdef
        or provolatile <> 'v'
        or proparallel <> 'u'
        or not coalesce(proconfig, array[]::text[])
          @> array['search_path=""']::text[]
      )
  ) then
    raise exception 'Owner, execution mode, volatility, parallel mode, or search_path drifted';
  end if;

  if pg_get_function_identity_arguments(v_increment) <> 'p_attempt_key text'
     or pg_get_function_result(v_increment)
       <> 'TABLE(failed_attempt_count integer, locked_until timestamp with time zone)'
     or pg_get_function_identity_arguments(v_clear) <> 'p_attempt_key text'
     or pg_get_function_result(v_clear) <> 'void' then
    raise exception 'Continuation RPC signature or return type drifted';
  end if;

  select array_agg(coalesce(role_name, 'PUBLIC') order by coalesce(role_name, 'PUBLIC'))
  into v_acl_roles
  from (
    select distinct role_entry.rolname as role_name
    from pg_catalog.pg_proc function_entry
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_entry.proacl,
        pg_catalog.acldefault('f', function_entry.proowner)
      )
    ) function_acl
    left join pg_catalog.pg_roles role_entry
      on role_entry.oid = function_acl.grantee
    where function_entry.oid = v_increment
      and function_acl.privilege_type = 'EXECUTE'
  ) roles;

  if v_acl_roles <> array['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role']::text[] then
    raise exception 'Increment RPC EXECUTE ACL drifted: %', v_acl_roles;
  end if;

  select array_agg(coalesce(role_name, 'PUBLIC') order by coalesce(role_name, 'PUBLIC'))
  into v_acl_roles
  from (
    select distinct role_entry.rolname as role_name
    from pg_catalog.pg_proc function_entry
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_entry.proacl,
        pg_catalog.acldefault('f', function_entry.proowner)
      )
    ) function_acl
    left join pg_catalog.pg_roles role_entry
      on role_entry.oid = function_acl.grantee
    where function_entry.oid = v_clear
      and function_acl.privilege_type = 'EXECUTE'
  ) roles;

  if v_acl_roles <> array['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role']::text[] then
    raise exception 'Clear RPC EXECUTE ACL drifted: %', v_acl_roles;
  end if;

  if not (
    select relrowsecurity and not relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.continuation_failed_attempts'::regclass
  ) then
    raise exception 'RLS contract changed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy
    where polrelid = 'public.continuation_failed_attempts'::regclass
  ) then
    raise exception 'Unexpected RLS policy on continuation_failed_attempts';
  end if;

  if position(
       'insert into public.continuation_failed_attempts'
       in lower(pg_get_functiondef(v_increment))
     ) = 0
     or position(
       'delete from public.continuation_failed_attempts'
       in lower(pg_get_functiondef(v_clear))
     ) = 0 then
    raise exception 'RPC relation references are not schema-qualified';
  end if;
end;
$contract$;

do $preservation$
begin
  if not exists (
    select 1
    from public.continuation_failed_attempts
    where attempt_key = 'r233-preserve-existing'
      and failed_attempt_count = 3
      and locked_until = '2026-11-23 12:34:56+00'::timestamptz
      and updated_at = '2026-11-23 12:00:00+00'::timestamptz
  ) then
    raise exception 'Existing failed-attempt row changed during migration';
  end if;
end;
$preservation$;

set local role service_role;

select *
from public.increment_continuation_failed_attempts('r233-isolation-a');
select *
from public.increment_continuation_failed_attempts('r233-isolation-a');
select *
from public.increment_continuation_failed_attempts('r233-isolation-b');

reset role;

do $isolation$
begin
  if not exists (
    select 1
    from public.continuation_failed_attempts
    where attempt_key = 'r233-isolation-a'
      and failed_attempt_count = 2
      and locked_until is null
  ) or not exists (
    select 1
    from public.continuation_failed_attempts
    where attempt_key = 'r233-isolation-b'
      and failed_attempt_count = 1
      and locked_until is null
  ) then
    raise exception 'Attempt keys are not isolated';
  end if;
end;
$isolation$;

set local role service_role;
select public.clear_continuation_failed_attempts('r233-isolation-a');
reset role;

do $clear_one_key$
begin
  if exists (
    select 1
    from public.continuation_failed_attempts
    where attempt_key = 'r233-isolation-a'
  ) or not exists (
    select 1
    from public.continuation_failed_attempts
    where attempt_key = 'r233-isolation-b'
      and failed_attempt_count = 1
  ) then
    raise exception 'Clear crossed attempt-key boundary';
  end if;
end;
$clear_one_key$;

set local role service_role;
select * from public.increment_continuation_failed_attempts('r233-isolation-b');
select * from public.increment_continuation_failed_attempts('r233-isolation-b');
select * from public.increment_continuation_failed_attempts('r233-isolation-b');
select * from public.increment_continuation_failed_attempts('r233-isolation-b');
reset role;

do $lock_threshold$
begin
  if not exists (
    select 1
    from public.continuation_failed_attempts
    where attempt_key = 'r233-isolation-b'
      and failed_attempt_count = 5
      and locked_until between now() + interval '14 minutes'
                           and now() + interval '16 minutes'
  ) then
    raise exception 'Fifth attempt did not establish the 15-minute lock';
  end if;
end;
$lock_threshold$;

set local role service_role;
select public.clear_continuation_failed_attempts('r233-isolation-b');
reset role;

do $cleanup_check$
begin
  if exists (
    select 1
    from public.continuation_failed_attempts
    where attempt_key in ('r233-isolation-a', 'r233-isolation-b')
  ) then
    raise exception 'Synthetic isolation rows were not cleared';
  end if;
end;
$cleanup_check$;

commit;

select 'PASS' as result,
       'contract, preservation, increment, clear, isolation, threshold' as checks;
