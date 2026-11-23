-- Structural fingerprint for public schema only. Reads no application rows.
with
relations as (
  select n.nspname || '|' || c.relname || '|' || c.relkind::text || '|'
         || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|'
         || pg_get_userbyid(c.relowner) as item
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'S')
),
columns as (
  select n.nspname || '|' || c.relname || '|' || a.attnum::text || '|'
         || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|'
         || a.attnotnull::text || '|'
         || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|'
         || a.attidentity::text || '|' || a.attgenerated::text as item
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm')
     and a.attnum > 0
     and not a.attisdropped
),
constraints as (
  select n.nspname || '|' || c.relname || '|' || co.conname || '|'
         || co.contype::text || '|' || co.condeferrable::text || '|'
         || co.condeferred::text || '|' || co.convalidated::text || '|'
         || pg_get_constraintdef(co.oid, true) as item
    from pg_constraint co
    join pg_class c on c.oid = co.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
),
indexes as (
  select schemaname || '|' || tablename || '|' || indexname || '|' || indexdef as item
    from pg_indexes
   where schemaname = 'public'
),
policies as (
  select schemaname || '|' || tablename || '|' || policyname || '|'
         || permissive || '|' || roles::text || '|' || cmd || '|'
         || coalesce(qual, '') || '|' || coalesce(with_check, '') as item
    from pg_policies
   where schemaname = 'public'
),
functions as (
  select n.nspname || '|' || p.proname || '|'
         || pg_get_function_identity_arguments(p.oid) || '|'
         || p.prosecdef::text || '|' || p.provolatile::text || '|'
         || p.prokind::text || '|' || pg_get_functiondef(p.oid) as item
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
triggers as (
  select n.nspname || '|' || c.relname || '|' || t.tgname || '|'
         || pg_get_triggerdef(t.oid, true) as item
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal
),
table_grants as (
  select table_name || '|' || grantee || '|' || privilege_type || '|'
         || is_grantable as item
    from information_schema.role_table_grants
   where table_schema = 'public'
),
function_acl as (
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
         || coalesce(grantee.rolname, 'PUBLIC') || '|'
         || acl.privilege_type::text || '|' || acl.is_grantable::text as item
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    left join pg_roles grantee on grantee.oid = acl.grantee
   where n.nspname = 'public'
),
extensions as (
  select e.extname || '|' || e.extversion || '|' || n.nspname as item
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname <> 'plpgsql'
)
select category,
       count(*)::integer as object_count,
       md5(coalesce(string_agg(item, E'\n' order by item), '')) as fingerprint
from (
  select 'relations' as category, item from relations
  union all select 'columns', item from columns
  union all select 'constraints', item from constraints
  union all select 'indexes', item from indexes
  union all select 'policies', item from policies
  union all select 'functions', item from functions
  union all select 'triggers', item from triggers
  union all select 'table_grants', item from table_grants
  union all select 'function_acl', item from function_acl
  union all select 'extensions', item from extensions
) fingerprint_items
group by category
order by category;
