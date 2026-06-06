-- Add telegram column to experts table
alter table experts
add column if not exists telegram text;

-- Make access_code unique if not already
-- (check existing index)
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where tablename = 'experts' and indexname = 'experts_access_code_key'
  ) then
    alter table experts add constraint experts_access_code_key unique (access_code);
  end if;
end $$;
