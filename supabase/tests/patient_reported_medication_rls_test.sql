BEGIN;
SELECT plan(26);

INSERT INTO public.patient_medication_orders (
  id, owner_type, owner_id, source_module, item_type, name,
  single_dose, dose_unit, frequency_type, times_per_day, start_date, ongoing
) VALUES (
  'a8000000-0000-4000-8000-000000000001',
  'anonymous_case', 'a8000000-0000-4000-8000-000000000002', 'support',
  'medication', 'synthetic-test-order', 1, 'tablet', 'times_per_day', 1, current_date, true
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.patient_medication_orders'::regclass),
  'patient medication orders have RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.medication_intake_logs'::regclass),
  'medication intake logs have RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.patient_medication_order_events'::regclass),
  'patient medication order audit has RLS enabled'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.patient_medication_orders', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.patient_medication_orders', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.patient_medication_orders', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.patient_medication_orders', 'DELETE'),
  'anon cannot access patient medication orders directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.patient_medication_orders', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.patient_medication_orders', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.patient_medication_orders', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.patient_medication_orders', 'DELETE'),
  'authenticated cannot access patient medication orders directly'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.medication_intake_logs', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.medication_intake_logs', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.medication_intake_logs', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.medication_intake_logs', 'DELETE'),
  'anon cannot access medication intake logs directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.medication_intake_logs', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.medication_intake_logs', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.medication_intake_logs', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.medication_intake_logs', 'DELETE'),
  'authenticated cannot access medication intake logs directly'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.patient_medication_order_events', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.patient_medication_order_events', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.patient_medication_order_events', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.patient_medication_order_events', 'DELETE'),
  'anon cannot access medication order audit directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.patient_medication_order_events', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.patient_medication_order_events', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.patient_medication_order_events', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.patient_medication_order_events', 'DELETE'),
  'authenticated cannot access medication order audit directly'
);

SELECT ok(has_table_privilege('service_role', 'public.patient_medication_orders', 'SELECT'), 'server role can read patient medication orders');
SELECT ok(has_table_privilege('service_role', 'public.patient_medication_orders', 'INSERT'), 'server role can create patient medication orders');
SELECT ok(has_table_privilege('service_role', 'public.patient_medication_orders', 'UPDATE'), 'server role can update patient medication orders');
SELECT ok(NOT has_table_privilege('service_role', 'public.patient_medication_orders', 'DELETE'), 'server role cannot hard-delete patient medication orders');
SELECT ok(has_table_privilege('service_role', 'public.medication_intake_logs', 'SELECT'), 'server role can read medication intake logs');
SELECT ok(has_table_privilege('service_role', 'public.medication_intake_logs', 'INSERT'), 'server role can create medication intake logs');
SELECT ok(has_table_privilege('service_role', 'public.medication_intake_logs', 'UPDATE'), 'server role can correct medication intake logs');
SELECT ok(NOT has_table_privilege('service_role', 'public.medication_intake_logs', 'DELETE'), 'server role cannot hard-delete medication intake logs');
SELECT ok(has_table_privilege('service_role', 'public.patient_medication_order_events', 'SELECT'), 'server role can read patient medication audit');
SELECT ok(has_table_privilege('service_role', 'public.patient_medication_order_events', 'INSERT'), 'server role can append patient medication audit');
SELECT ok(NOT has_table_privilege('service_role', 'public.patient_medication_order_events', 'UPDATE'), 'server role cannot update patient medication audit');
SELECT ok(NOT has_table_privilege('service_role', 'public.patient_medication_order_events', 'DELETE'), 'server role cannot delete patient medication audit');

SET LOCAL ROLE service_role;
INSERT INTO public.patient_medication_orders (
  id, owner_type, owner_id, source_module, item_type, name,
  single_dose, dose_unit, frequency_type, times_per_day, start_date, ongoing
) VALUES (
  'a8000000-0000-4000-8000-000000000003',
  'anonymous_profile', 'a8000000-0000-4000-8000-000000000004', 'health',
  'supplement', 'synthetic-test-supplement', 1, 'capsule', 'times_per_day', 1, current_date, true
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.patient_medication_order_events WHERE medication_order_id = 'a8000000-0000-4000-8000-000000000003'),
  1,
  'server-side insert appends an audit event through the trigger'
);

SELECT throws_ok(
  $$INSERT INTO public.medication_intake_logs (
      owner_type, owner_id, medication_order_id, scheduled_date, scheduled_slot, status
    ) VALUES (
      'anonymous_case', 'a8000000-0000-4000-8000-000000000099',
      'a8000000-0000-4000-8000-000000000001', current_date, 1, 'taken'
    )$$,
  '23503', NULL,
  'intake owner identity must match its order'
);

SELECT throws_ok(
  $$UPDATE public.patient_medication_order_events SET event_type = 'updated' WHERE medication_order_id = 'a8000000-0000-4000-8000-000000000001'$$,
  '55000', 'patient medication audit records are append-only',
  'audit events cannot be updated even by the database owner'
);
SELECT throws_ok(
  $$DELETE FROM public.patient_medication_order_events WHERE medication_order_id = 'a8000000-0000-4000-8000-000000000001'$$,
  '55000', 'patient medication audit records are append-only',
  'audit events cannot be deleted even by the database owner'
);
SELECT throws_ok(
  $$DELETE FROM public.patient_medication_orders WHERE id = 'a8000000-0000-4000-8000-000000000001'$$,
  '23503', NULL,
  'orders with audit history cannot be deleted'
);

SELECT * FROM finish();
ROLLBACK;
