-- Clinical Longitudinal v0.4.2: READ-ONLY full-medical-staging compatibility check.
-- Metadata only: no patient records, medication names, keys or secrets.
-- Must be run on a synthetic copy of the real Support medical schema, NEVER
-- as permission to enable production.
WITH required_functions(name,signature) AS (
 VALUES
 ('activate','public.activate_medication_order(text,uuid,uuid,uuid,uuid,text,text,numeric,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text[],text,text,text,uuid)'),
 ('supersede','public.supersede_medication_order(uuid,text,uuid,uuid,uuid,uuid,text,text,numeric,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text[],text,text,text,uuid)'),
 ('revoke','public.revoke_medication_order(uuid,text,uuid,uuid,uuid,text,text,text,uuid)')
)
SELECT name,signature,
 to_regprocedure(signature) IS NOT NULL AS rpc_signature_matches,
 CASE WHEN to_regprocedure(signature) IS NOT NULL
 THEN has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE')
 ELSE false END AS service_role_can_execute,
 CASE WHEN to_regprocedure(signature) IS NOT NULL
 THEN has_function_privilege('anon',to_regprocedure(signature),'EXECUTE')
 ELSE false END AS anonymous_can_execute,
 CASE WHEN to_regprocedure(signature) IS NOT NULL
 THEN has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')
 ELSE false END AS end_user_can_execute
FROM required_functions ORDER BY name;

WITH required(table_name,field) AS (
VALUES
 ('medication_orders','id'),
 ('medication_orders','order_group_id'),
 ('medication_orders','version_number'),
 ('medication_orders','supersedes_order_id'),
 ('medication_orders','owner_type'),
 ('medication_orders','owner_id'),
 ('medication_orders','organization_id'),
 ('medication_orders','prescriber_expert_id'),
 ('medication_orders','prescriber_authorization_id'),
 ('medication_orders','medication_name_snapshot'),
 ('medication_orders','formulation_snapshot'),
 ('medication_orders','strength_value'),
 ('medication_orders','strength_unit'),
 ('medication_orders','route_code'),
 ('medication_orders','issued_at'),
 ('medication_orders','valid_from'),
 ('medication_orders','valid_until'),
 ('medication_order_schedules','medication_order_id'),
 ('medication_order_schedules','phase_number'),
 ('medication_order_schedules','dose_amount'),
 ('medication_order_schedules','dose_unit'),
 ('medication_order_schedules','frequency_code'),
 ('medication_order_schedules','route_code'),
 ('medication_order_schedules','phase_start_at'),
 ('medication_order_schedules','phase_end_at'),
 ('medication_order_schedules','dosing_mode'),
 ('medication_order_lifecycle_events','id'),
 ('medication_order_lifecycle_events','medication_order_id'),
 ('medication_order_lifecycle_events','event_type'),
 ('medication_order_lifecycle_events','actor_type'),
 ('medication_order_lifecycle_events','actor_expert_id'),
 ('medication_order_lifecycle_events','idempotency_key'),
 ('clinician_medication_authorizations','id'),
 ('clinician_medication_authorizations','expert_id'),
 ('clinician_medication_authorizations','organization_id'),
 ('clinician_medication_authorizations','jurisdiction'),
 ('clinician_medication_authorizations','authorization_scope'),
 ('clinician_medication_authorizations','verification_status'),
 ('clinician_medication_authorizations','revoked_at'),
 ('clinician_medication_authorizations','valid_from'),
 ('clinician_medication_authorizations','valid_until')
)
SELECT table_name,count(*) AS expected_fields,
 count(*) FILTER (WHERE EXISTS(
  SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
   AND c.table_name=required.table_name AND c.column_name=required.field
 )) AS found_fields,
 array_agg(field ORDER BY field) FILTER (WHERE NOT EXISTS(
  SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
   AND c.table_name=required.table_name AND c.column_name=required.field
 )) AS missing_fields
FROM required GROUP BY table_name ORDER BY table_name;
-- 'All found' is necessary but not sufficient. Review RLS, org linkage,
-- existing prescriptions requiring backfill, function bodies, role boundaries,
-- clinical consent, retention and snapshot fidelity before enabling the flag.
