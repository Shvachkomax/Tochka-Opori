-- A3.8.2: one server-side catalog with explicit Support / Health visibility.
-- Existing services remain visible in both modules for backward compatibility;
-- doctors can narrow the visibility from the authenticated cabinet.

alter table public.practice_services
  add column if not exists modules text[];

update public.practice_services
set modules = array['support', 'body']::text[]
where modules is null;

alter table public.practice_services
  alter column modules set default array['support', 'body']::text[],
  alter column modules set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.practice_services'::regclass
      and conname = 'practice_services_modules_check'
  ) then
    alter table public.practice_services
      add constraint practice_services_modules_check
      check (
        cardinality(modules) > 0
        and modules <@ array['support', 'body']::text[]
      );
  end if;
end
$$;

create index if not exists practice_services_active_modules_idx
  on public.practice_services using gin (modules)
  where is_active;

comment on column public.practice_services.modules is
  'Patient cabinet modules allowed to show the published service: support and/or body (Health).';
