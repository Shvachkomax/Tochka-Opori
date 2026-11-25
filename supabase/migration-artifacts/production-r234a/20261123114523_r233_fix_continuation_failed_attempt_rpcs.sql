-- R2.3.3: repair the two continuation rate-limit RPCs without changing their
-- signatures, owners, SECURITY INVOKER semantics, volatility, search_path, or
-- existing EXECUTE grants. The known Production definitions have an empty
-- search_path but refer to continuation_failed_attempts without a schema.
-- Transaction ownership is intentionally left to the Supabase migration
-- runner; embedded BEGIN/COMMIT would break its atomic history wrapper.

do $preconditions$
declare
  v_increment oid := to_regprocedure(
    'public.increment_continuation_failed_attempts(text)'
  );
  v_clear oid := to_regprocedure(
    'public.clear_continuation_failed_attempts(text)'
  );
begin
  if to_regclass('public.continuation_failed_attempts') is null then
    raise exception 'Missing prerequisite table public.continuation_failed_attempts';
  end if;

  if v_increment is null or v_clear is null then
    raise exception 'Missing prerequisite continuation failed-attempt RPC';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc
    where oid in (v_increment, v_clear)
      and prosecdef
  ) then
    raise exception 'Unexpected SECURITY DEFINER continuation RPC contract';
  end if;

  if (
    select not relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.continuation_failed_attempts'::regclass
  ) then
    raise exception 'RLS must remain enabled on public.continuation_failed_attempts';
  end if;
end;
$preconditions$;

create or replace function public.increment_continuation_failed_attempts(
  p_attempt_key text
)
returns table(
  failed_attempt_count integer,
  locked_until timestamptz
)
language plpgsql
volatile
parallel unsafe
security invoker
set search_path = ''
as $function$
begin
  return query
  insert into public.continuation_failed_attempts as attempts (
    attempt_key,
    failed_attempt_count,
    locked_until,
    updated_at
  )
  values (
    p_attempt_key,
    1,
    null,
    pg_catalog.now()
  )
  on conflict (attempt_key)
  do update set
    failed_attempt_count = attempts.failed_attempt_count + 1,
    locked_until = case
      when attempts.failed_attempt_count + 1 >= 5
        then pg_catalog.now() + interval '15 minutes'
      else null
    end,
    updated_at = pg_catalog.now()
  returning attempts.failed_attempt_count, attempts.locked_until;
end;
$function$;

create or replace function public.clear_continuation_failed_attempts(
  p_attempt_key text
)
returns void
language plpgsql
volatile
parallel unsafe
security invoker
set search_path = ''
as $function$
begin
  delete from public.continuation_failed_attempts as attempts
  where attempts.attempt_key = p_attempt_key;
end;
$function$;

do $postconditions$
declare
  v_increment oid := to_regprocedure(
    'public.increment_continuation_failed_attempts(text)'
  );
  v_clear oid := to_regprocedure(
    'public.clear_continuation_failed_attempts(text)'
  );
begin
  if exists (
    select 1
    from pg_catalog.pg_proc
    where oid in (v_increment, v_clear)
      and (
        prosecdef
        or provolatile <> 'v'
        or proparallel <> 'u'
        or not coalesce(proconfig, array[]::text[])
          @> array['search_path=""']::text[]
      )
  ) then
    raise exception 'Continuation RPC contract changed unexpectedly';
  end if;
end;
$postconditions$;
