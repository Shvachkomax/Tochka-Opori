-- READ-ONLY preflight for the clinical outbox draft. Run only against the intended
-- future Russian medical database after approving the data-processing architecture.
-- No patient rows or secrets are read; metadata only.
WITH required_sources(table_name) AS (
  VALUES ('sessions'), ('service_requests'), ('medication_orders'),
         ('medication_order_lifecycle_events'), ('clinician_decisions'),
         ('clinical_outcomes'), ('clinical_observations'),
         ('patient_medication_orders'), ('patient_medication_order_events'),
         ('medication_intake_logs'), ('body_daily_logs'), ('support_daily_checkins')
), fields AS (
  SELECT r.table_name,
         to_regclass('public.' || r.table_name) IS NOT NULL AS exists_in_public,
         EXISTS (SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema='public' AND c.table_name=r.table_name
             AND c.column_name IN ('id','session_id')) AS has_stable_reference,
         EXISTS (SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema='public' AND c.table_name=r.table_name
             AND c.column_name IN ('owner_id','anonymous_owner_id')) AS has_owner_reference,
         EXISTS (SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema='public' AND c.table_name=r.table_name
             AND c.column_name='organization_id') AS has_explicit_organization,
         EXISTS (SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema='public' AND c.table_name=r.table_name
             AND c.column_name IN ('updated_at','created_at','occurred_at')) AS has_event_time
  FROM required_sources r
)
SELECT * FROM fields ORDER BY table_name;
-- Any missing table or absent stable reference blocks migration.
-- Lack of explicit organization and owner links requires manual scope analysis;
-- it must not be overridden with an implicit join across clinics.
