-- Clinical Longitudinal v0.4: READ-ONLY contract preflight.
-- This query accesses only PostgreSQL catalog metadata, never patient records.
-- Run against a separately authorized STAGING clone of the eventual Russian
-- medical database, not production. Do not assume absent fields are safe.
WITH sources(module,source_table,expected) AS (
  VALUES
   ('support','sessions','patient encounters and care routing'),
   ('support','clinician_decisions','diagnosis and clinician decisions'),
   ('support','medication_orders','prescription orders and prescriber'),
   ('support','medication_order_schedules','dose, frequency and treatment phases'),
   ('support','medication_order_lifecycle_events','changes, cancellation and outcomes'),
   ('support','clinical_observations','observed clinical measurements'),
   ('support','clinical_outcomes','evaluated follow-up'),
   ('health','body_clients','health session to patient association'),
   ('health','body_daily_logs','weight, sleep and other patient diaries'),
   ('both','patient_medication_orders','patient-reported medication'),
   ('both','patient_medication_order_events','patient-reported medication changes'),
   ('both','medication_intake_logs','reported actual medication intake'),
   ('both','service_requests','clinician requests and follow-up')
), objects AS (
 SELECT s.*,
  to_regclass(format('public.%I',s.source_table)) AS rel_oid
 FROM sources s
), columns AS (
 SELECT o.*,
  COALESCE(ARRAY(
   SELECT a.attname::text FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=o.rel_oid AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY a.attnum
  ), ARRAY[]::text[]) AS column_names
 FROM objects o
)
SELECT module,source_table,expected,
       rel_oid IS NOT NULL AS exists_in_database,
       column_names && ARRAY['id','session_id']::text[] AS has_record_key,
       column_names && ARRAY['owner_id','anonymous_owner_id']::text[] AS has_patient_owner,
       'organization_id'=ANY(column_names) AS has_organization_id,
       'module'=ANY(column_names) AS has_module,
       column_names && ARRAY[
         'author_expert_id','expert_id','prescriber_expert_id',
         'actor_expert_id','recorded_by_expert_id'
       ]::text[] AS has_candidate_doctor_actor,
       column_names && ARRAY[
         'created_at','recorded_at','observed_at','occurred_at',
         'issued_at','assessed_at','log_date'
       ]::text[] AS has_timestamp,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_class c
         WHERE c.oid=rel_oid AND c.relrowsecurity
       ) AS rls_enabled,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid=rel_oid AND NOT t.tgisinternal
       ) AS has_custom_trigger,
       (SELECT COUNT(*) FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid=rel_oid AND NOT t.tgisinternal) AS custom_trigger_count
FROM columns ORDER BY module,source_table;

-- Important: the presence of a candidate author field, organization_id,
-- or RLS does NOT certify access control. This output must be reviewed alongside
-- policies, tenant-bound foreign keys, explicit consent and actual write paths.
-- Do not publish individual patient row values as part of the review.
