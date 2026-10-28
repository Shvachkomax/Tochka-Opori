-- v0.4.5 Real Support RPC test against the PERSISTENT staging archive.
-- Run only on reviewed Tochka-Opori-Preview-Test after applying 065.
-- Synthetic fixtures ONLY, no production data. Every clinical write is rolled back.
BEGIN;
DO $gate$ BEGIN
 IF to_regclass('clinical_medication_archive.order_history') IS NULL THEN
  RAISE EXCEPTION 'Staging archive not installed';
 END IF;
 IF EXISTS(SELECT 1 FROM clinical_medication_archive.order_history) THEN
  RAISE EXCEPTION 'Expected empty test archive; refusing synthetic fixture test';
 END IF;
END $gate$;
-- C2 v0.1 synthetic TEST smoke. Everything is rolled back at the end.

DO $$
DECLARE
  expert_id uuid := '11111111-1111-4111-8111-111111111111';
  unauthorized_expert_id uuid := '22222222-2222-4222-8222-222222222222';
  owner_id uuid := '33333333-3333-4333-8333-333333333333';
  concept_id uuid := '44444444-4444-4444-8444-444444444444';
  auth_id uuid := '55555555-5555-4555-8555-555555555555';
  order_v1 uuid;
  order_v2 uuid;
  retry_order uuid;
  conflict_raised boolean := false;
  supersede_conflict_raised boolean := false;
  revoke_conflict_raised boolean := false;
  unauthorized_raised boolean := false;
  body_raised boolean := false;
  stale_raised boolean := false;
  update_raised boolean := false;
  delete_raised boolean := false;
  invalid_schedule_raised boolean := false;
  invalid_permission_raised boolean := false;
  issued_at timestamptz := now() - interval '1 hour';
  valid_from timestamptz := now() - interval '1 hour';
  valid_until timestamptz := now() + interval '30 days';
  phase_end timestamptz := now() + interval '30 days';
  v2_issued_at timestamptz := now() - interval '30 minutes';
  v2_valid_from timestamptz := now() - interval '30 minutes';
  v2_phase_end timestamptz := now() + interval '7 days';
  v1_schedule jsonb;
  v2_schedule jsonb;
  result jsonb;
BEGIN
  INSERT INTO public.experts (id, name, access_code, is_active, allowed_modules)
  VALUES (expert_id, 'C2 synthetic prescriber', 'C2-SYNTH-PRESCRIBER', true, ARRAY['support']::text[]);

  INSERT INTO public.experts (id, name, access_code, is_active, allowed_modules)
  VALUES (unauthorized_expert_id, 'C2 synthetic non-prescriber', 'C2-SYNTH-NON-PRESCRIBER', true, ARRAY['support']::text[]);

  INSERT INTO public.sessions (id, public_code, session_id, module, anonymous_owner_id)
  VALUES ('66666666-6666-4666-8666-666666666666', 'C2-SYNTH-PUBLIC', 'c2-synthetic-session', 'support', owner_id);

  INSERT INTO public.patient_assignments (public_code, primary_expert_id, status, module)
  VALUES ('C2-SYNTH-PUBLIC', expert_id, 'active', 'support');

  INSERT INTO public.medication_concepts (
    id, concept_code, source_system, jurisdiction, canonical_name, display_name, concept_kind, status
  ) VALUES (
    concept_id, 'c2.synthetic.medication', 'internal', 'RU', 'Synthetic medication', 'Тестовый препарат', 'single_ingredient', 'active'
  );

  INSERT INTO public.medication_concept_ingredients (
    medication_concept_id, ingredient_code, ingredient_name, strength_value, strength_unit, sequence_no
  ) VALUES (concept_id, 'c2.synthetic.ingredient', 'Synthetic active ingredient', 25, 'mg', 1);

  INSERT INTO public.clinician_medication_authorizations (
    id, expert_id, organization_id, jurisdiction, authorization_scope, verification_status,
    valid_from, valid_until, verification_provenance, verification_reference, verified_at
  ) VALUES (
    auth_id, expert_id, NULL, 'RU', 'prescribe_medications', 'verified',
    issued_at - interval '1 day', valid_until, 'operator_manual_test', 'c2-synthetic-auth', issued_at - interval '1 day'
  );

  v1_schedule := jsonb_build_array(jsonb_build_object(
    'phase_number', 1,
    'dosing_mode', 'fixed',
    'phase_start_at', valid_from,
    'phase_end_at', phase_end,
    'dose_amount', 25,
    'dose_unit', 'mg',
    'frequency_code', 'once_daily',
    'route_code', 'oral',
    'administration_time_local', NULL,
    'timezone', 'Europe/Moscow',
    'max_daily_dose_amount', NULL,
    'max_daily_dose_unit', NULL
  ));

  SELECT public.clinical_activate_medication_order(
    'anonymous_case', owner_id, NULL, auth_id, concept_id,
    'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
    'Принимать по назначению специалиста.', issued_at, valid_from, valid_until,
    v1_schedule, ARRAY['view_authorized_order', 'show_authorized_schedule']::text[],
    'Назначить тестовое лечение.', 'Основание для synthetic smoke.', 'c2-smoke-activate-v1', expert_id
  ) INTO result;
  order_v1 := (result->>'order_id')::uuid;

  IF (SELECT count(*) FROM public.medication_orders WHERE id = order_v1) <> 1
     OR (SELECT count(*) FROM public.medication_order_schedules WHERE medication_order_id = order_v1) <> 1
     OR (SELECT count(*) FROM public.medication_order_lifecycle_events WHERE medication_order_id = order_v1 AND event_type = 'activated') <> 1
     OR (SELECT count(*) FROM public.medication_ai_permissions WHERE medication_order_id = order_v1 AND permission_action = 'grant') <> 2
     OR (SELECT count(*) FROM public.clinician_decisions WHERE id = (SELECT source_decision_id FROM public.medication_orders WHERE id = order_v1)) <> 1
     OR (SELECT count(*) FROM public.clinical_events WHERE id = (SELECT clinical_event_id FROM public.medication_orders WHERE id = order_v1)) <> 1 THEN
    RAISE EXCEPTION 'activation aggregate is incomplete';
  END IF;
  IF (SELECT medication_name_snapshot FROM public.medication_orders WHERE id = order_v1) <> 'Тестовый препарат' THEN
    RAISE EXCEPTION 'activation did not bind medication name to catalog';
  END IF;

  UPDATE public.medication_concepts SET display_name = 'Тестовый препарат B' WHERE id = concept_id;
  IF (SELECT medication_name_snapshot FROM public.medication_orders WHERE id = order_v1) <> 'Тестовый препарат' THEN
    RAISE EXCEPTION 'historical medication snapshot changed with catalog';
  END IF;

  SELECT (public.clinical_activate_medication_order(
    'anonymous_case', owner_id, NULL, auth_id, concept_id,
    'Drug B spoof', 'tablet', 25, 'mg', 'oral', NULL,
    'Принимать по назначению специалиста.', issued_at, valid_from, valid_until,
    v1_schedule, ARRAY['view_authorized_order', 'show_authorized_schedule']::text[],
    'Назначить тестовое лечение.', 'Основание для synthetic smoke.', 'c2-smoke-activate-v1', expert_id
  )->>'order_id')::uuid INTO retry_order;
  IF retry_order <> order_v1 OR (SELECT count(*) FROM public.medication_orders WHERE creation_idempotency_key = 'c2-smoke-activate-v1') <> 1 THEN
    RAISE EXCEPTION 'activation idempotency failed';
  END IF;
  SELECT (public.clinical_activate_medication_order(
    'anonymous_case', owner_id, NULL, auth_id, concept_id,
    NULL, 'tablet', 25, 'mg', 'oral', NULL,
    'Принимать по назначению специалиста.', issued_at, valid_from, valid_until,
    v1_schedule, ARRAY['view_authorized_order', 'show_authorized_schedule']::text[],
    'Назначить тестовое лечение.', 'Основание для synthetic smoke.', 'c2-smoke-activate-v1', expert_id
  )->>'order_id')::uuid INTO retry_order;
  IF retry_order <> order_v1 THEN RAISE EXCEPTION 'empty browser medication name changed replay'; END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 50, 'mg', 'oral', NULL,
      'Другая инструкция.', issued_at, valid_from, valid_until,
      v1_schedule, ARRAY['view_authorized_order']::text[],
      'Конфликтующий запрос.', NULL, 'c2-smoke-activate-v1', expert_id
    );
    RAISE EXCEPTION 'idempotency conflict was accepted';
  EXCEPTION WHEN unique_violation THEN
    conflict_raised := true;
  END;
  IF NOT conflict_raised THEN RAISE EXCEPTION 'idempotency conflict was not rejected'; END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
      NULL, issued_at, valid_from, valid_until, v1_schedule,
      ARRAY['view_authorized_order']::text[], 'Unauthorized test.', NULL,
      'c2-smoke-unauthorized', unauthorized_expert_id
    );
    RAISE EXCEPTION 'unauthorized prescriber was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    unauthorized_raised := true;
  END;
  IF NOT unauthorized_raised THEN RAISE EXCEPTION 'unauthorized prescriber was not rejected'; END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_profile', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
      NULL, issued_at, valid_from, valid_until, v1_schedule,
      ARRAY['view_authorized_order']::text[], 'Body test.', NULL,
      'c2-smoke-body', expert_id
    );
    RAISE EXCEPTION 'Body runtime was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    body_raised := true;
  END;
  IF NOT body_raised THEN RAISE EXCEPTION 'Body runtime was not rejected'; END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
      NULL, issued_at, valid_from, valid_until,
      jsonb_build_array(jsonb_build_object(
        'phase_number', 1, 'dosing_mode', 'fixed', 'phase_start_at', valid_from,
        'phase_end_at', phase_end, 'dose_amount', 25, 'dose_unit', 'mg',
        'frequency_code', 'prn', 'route_code', 'oral', 'timezone', 'Europe/Moscow'
      )), ARRAY['view_authorized_order']::text[], 'Invalid schedule.', NULL,
      'c2-smoke-invalid-schedule', expert_id
    );
    RAISE EXCEPTION 'invalid schedule was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    invalid_schedule_raised := true;
  END;
  IF NOT invalid_schedule_raised OR (SELECT count(*) FROM public.medication_orders WHERE creation_idempotency_key = 'c2-smoke-invalid-schedule') <> 0 THEN
    RAISE EXCEPTION 'invalid schedule was not atomically rejected';
  END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
      NULL, issued_at, valid_from, valid_until, v1_schedule,
      ARRAY['change_dose']::text[], 'Invalid permission.', NULL,
      'c2-smoke-invalid-permission', expert_id
    );
    RAISE EXCEPTION 'invalid permission was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    invalid_permission_raised := true;
  END;
  IF NOT invalid_permission_raised OR (SELECT count(*) FROM public.medication_orders WHERE creation_idempotency_key = 'c2-smoke-invalid-permission') <> 0 THEN
    RAISE EXCEPTION 'invalid permission was not atomically rejected';
  END IF;

  BEGIN
    UPDATE public.medication_orders SET clinician_instruction = 'forbidden update' WHERE id = order_v1;
    RAISE EXCEPTION 'order update was accepted';
  EXCEPTION WHEN sqlstate '55000' THEN
    update_raised := true;
  END;
  IF NOT update_raised THEN RAISE EXCEPTION 'order immutability trigger did not fire'; END IF;

  BEGIN
    DELETE FROM public.medication_orders WHERE id = order_v1;
    RAISE EXCEPTION 'order delete was accepted';
  EXCEPTION WHEN sqlstate '55000' THEN
    delete_raised := true;
  END;
  IF NOT delete_raised THEN RAISE EXCEPTION 'order delete immutability trigger did not fire'; END IF;

  BEGIN
    UPDATE public.medication_order_schedules SET dose_amount = 99 WHERE medication_order_id = order_v1;
    RAISE EXCEPTION 'schedule update was accepted';
  EXCEPTION WHEN sqlstate '55000' THEN
    NULL;
  END;

  BEGIN
    UPDATE public.medication_ai_permissions SET permission_key = 'change_dose' WHERE medication_order_id = order_v1;
    RAISE EXCEPTION 'permission update was accepted';
  EXCEPTION WHEN sqlstate '55000' THEN
    NULL;
  END;

  v2_schedule := jsonb_build_array(
    jsonb_build_object(
      'phase_number', 1, 'dosing_mode', 'titration', 'phase_start_at', v2_valid_from,
      'phase_end_at', v2_phase_end, 'dose_amount', 25, 'dose_unit', 'mg',
      'frequency_code', 'once_daily', 'route_code', 'oral', 'timezone', 'Europe/Moscow'
    ),
    jsonb_build_object(
      'phase_number', 2, 'dosing_mode', 'titration', 'phase_start_at', v2_phase_end,
      'phase_end_at', NULL, 'dose_amount', 50, 'dose_unit', 'mg',
      'frequency_code', 'once_daily', 'route_code', 'oral', 'timezone', 'Europe/Moscow'
    )
  );

  SELECT public.clinical_supersede_medication_order(
    order_v1, 'anonymous_case', owner_id, NULL, auth_id, concept_id,
    'Drug B spoof', 'tablet', 50, 'mg', 'oral', NULL,
    'Новая версия назначения.', v2_issued_at, v2_valid_from, valid_until,
    v2_schedule, ARRAY['view_authorized_order', 'explain_authorized_order']::text[],
    'Изменить тестовое лечение.', 'Новая clinical decision.', 'c2-smoke-supersede-v2', expert_id
  ) INTO result;
  order_v2 := (result->>'order_id')::uuid;

  IF (SELECT supersedes_order_id FROM public.medication_orders WHERE id = order_v2) <> order_v1
     OR (SELECT count(*) FROM public.medication_order_schedules WHERE medication_order_id = order_v2) <> 2
     OR (SELECT count(*) FROM public.medication_order_lifecycle_events WHERE medication_order_id = order_v1 AND event_type = 'superseded') <> 1
     OR (SELECT count(*) FROM public.medication_ai_permissions WHERE medication_order_id = order_v1 AND permission_action = 'revoke') <> 2
     OR (SELECT count(*) FROM public.medication_ai_permissions WHERE medication_order_id = order_v2 AND permission_action = 'grant') <> 2
     OR (SELECT count(*) FROM public.clinical_events WHERE event_type IN ('medication_order_superseded', 'medication_order_activated') AND source_id IN (order_v1::text, order_v2::text)) <> 3 THEN
    RAISE EXCEPTION 'supersession aggregate is incomplete';
  END IF;
  IF (SELECT medication_name_snapshot FROM public.medication_orders WHERE id = order_v2) <> 'Тестовый препарат B' THEN
    RAISE EXCEPTION 'supersession did not bind medication name to catalog';
  END IF;

  BEGIN
    PERFORM public.clinical_supersede_medication_order(
      order_v1, 'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 55, 'mg', 'oral', NULL,
      'Изменённая версия.', v2_issued_at, v2_valid_from, valid_until,
      v2_schedule, ARRAY['view_authorized_order']::text[],
      'Изменённое решение.', NULL, 'c2-smoke-supersede-v2', expert_id
    );
    RAISE EXCEPTION 'supersede idempotency conflict was accepted';
  EXCEPTION WHEN unique_violation THEN
    supersede_conflict_raised := true;
  END;
  IF NOT supersede_conflict_raised OR (SELECT count(*) FROM public.medication_orders WHERE order_group_id = (SELECT order_group_id FROM public.medication_orders WHERE id = order_v1)) <> 2 THEN
    RAISE EXCEPTION 'supersede idempotency conflict was not rejected';
  END IF;

  BEGIN
    PERFORM public.clinical_supersede_medication_order(
      order_v1, 'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 60, 'mg', 'oral', NULL,
      'Stale version.', v2_issued_at, v2_valid_from, valid_until,
      v2_schedule, ARRAY['view_authorized_order']::text[],
      'Stale decision.', NULL, 'c2-smoke-stale-v1', expert_id
    );
    RAISE EXCEPTION 'stale supersession was accepted';
  EXCEPTION WHEN raise_exception THEN
    stale_raised := true;
  END;
  IF NOT stale_raised THEN RAISE EXCEPTION 'stale supersession was not rejected'; END IF;

  SELECT public.clinical_revoke_medication_order(
    order_v2, 'anonymous_case', owner_id, NULL, auth_id,
    'clinician_decision', 'Отозвано для synthetic smoke.', 'c2-smoke-revoke-v2', expert_id
  ) INTO result;
  IF (SELECT count(*) FROM public.medication_order_lifecycle_events WHERE medication_order_id = order_v2 AND event_type = 'revoked') <> 1
     OR (SELECT count(*) FROM public.medication_ai_permissions WHERE medication_order_id = order_v2 AND permission_action = 'revoke') <> 2 THEN
    RAISE EXCEPTION 'revocation aggregate is incomplete';
  END IF;

  BEGIN
    PERFORM public.clinical_revoke_medication_order(
      order_v2, 'anonymous_case', owner_id, NULL, auth_id,
      'different_reason', 'Другой смысл операции.', 'c2-smoke-revoke-v2', expert_id
    );
    RAISE EXCEPTION 'revoke idempotency conflict was accepted';
  EXCEPTION WHEN unique_violation THEN
    revoke_conflict_raised := true;
  END;
  IF NOT revoke_conflict_raised OR (SELECT count(*) FROM public.medication_order_lifecycle_events WHERE medication_order_id = order_v2 AND event_type = 'revoked') <> 1 THEN
    RAISE EXCEPTION 'revoke idempotency conflict was not rejected';
  END IF;

  SELECT public.clinical_revoke_medication_order(
    order_v2, 'anonymous_case', owner_id, NULL, auth_id,
    'clinician_decision', 'Отозвано для synthetic smoke.', 'c2-smoke-revoke-v2', expert_id
  ) INTO result;
  IF result->>'idempotent_replay' <> 'true' THEN RAISE EXCEPTION 'revocation idempotency failed'; END IF;

  RAISE NOTICE 'C2 medication smoke passed';
END;
$$;


DO $archive_verify$
DECLARE
  v1 record;
  v2 record;
  v3 record;
  n integer;
  first_order record;
  v_failed uuid;
  v_auth uuid := '55555555-5555-4555-8555-555555555555';
  v_exp uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '33333333-3333-4333-8333-333333333333';
  v_concept uuid := '44444444-4444-4444-8444-444444444444';
  v_time timestamptz := now()-interval '35 minutes';
  v_end timestamptz := now()+interval '14 days';
  v_schedule jsonb;
BEGIN
 SELECT * INTO v1 FROM clinical_medication_archive.order_history WHERE action='activate';
 SELECT * INTO v2 FROM clinical_medication_archive.order_history WHERE action='supersede';
 SELECT * INTO v3 FROM clinical_medication_archive.order_history WHERE action='revoke';
 SELECT count(*) INTO n FROM clinical_medication_archive.order_history;
 IF n<>3 OR v1.id IS NULL OR v2.id IS NULL OR v3.id IS NULL THEN
   RAISE EXCEPTION 'archive should hold exactly 3 lifecycle versions, got %',n;
 END IF;
 IF v1.owner_id<>v_owner OR v2.owner_id<>v_owner OR v3.owner_id<>v_owner
    OR v1.organization_id IS NOT NULL
    OR v2.group_id<>v1.group_id OR v3.group_id<>v1.group_id
    OR v2.version_number<>2 OR v3.version_number<>2
    OR v3.new_state->>'state'<>'revoked' THEN
   RAISE EXCEPTION 'archive scope or treatment lineage mismatch';
 END IF;
 IF (v1.new_state->'schedules'->0->>'dose_amount')::numeric<>25
  OR (v2.new_state->'schedules'->1->>'dose_amount')::numeric<>50
  OR jsonb_array_length(v2.new_state->'schedules')<>2
  OR v2.previous_state->>'state'<>'active'
  OR v3.previous_state->>'state'<>'active' THEN
  RAISE EXCEPTION 'titration, 2 phases or before/after state missing';
 END IF;
 IF v1.author_status<>'verified_authorization_checked'
   OR v1.actor_authorization_id<>v_auth
   OR v2.actor_expert_id<>v_exp
   OR v3.actor_expert_id<>v_exp THEN
  RAISE EXCEPTION 'verified prescriber provenance not recorded';
 END IF;
 IF has_function_privilege('anon', 'public.clinical_activate_medication_order(text,uuid,uuid,uuid,uuid,text,text,numeric,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text[],text,text,text,uuid)', 'EXECUTE')
  OR has_table_privilege('authenticated','clinical_medication_archive.order_history','SELECT') THEN
  RAISE EXCEPTION 'archive or mutation callable by browser';
 END IF;

 v_schedule:=jsonb_build_array(jsonb_build_object(
 'phase_number',1,'dosing_mode','fixed','phase_start_at',v_time,
 'phase_end_at',v_end,'dose_amount',25,'dose_unit','mg',
 'frequency_code','once_daily','route_code','oral','timezone','Europe/Moscow'
 ));
 -- Refuse to archive a new v2 for an existing course that has no verified v1 snapshot.
 SELECT * INTO first_order FROM public.medication_orders
 WHERE creation_idempotency_key='c2-smoke-activate-v1';
 SELECT id INTO v_failed FROM public.medication_orders
 WHERE creation_idempotency_key='c2-real-rpc-legacy-v1';
 IF v_failed IS NOT NULL THEN RAISE EXCEPTION 'unexpected test collision'; END IF;
 -- A separate new course is created outside the archive to simulate a legacy group.
 PERFORM public.activate_medication_order(
  'anonymous_case',v_owner,NULL,v_auth,v_concept,
  NULL,'tablet',25,'mg','oral',NULL,NULL,v_time,v_time,v_end,
  v_schedule,ARRAY[]::text[],'Учебное решение',NULL,
  'c2-real-rpc-legacy-v1',v_exp
 );
 SELECT * INTO first_order FROM public.medication_orders
 WHERE creation_idempotency_key='c2-real-rpc-legacy-v1';
 BEGIN
   PERFORM public.clinical_supersede_medication_order(
     first_order.id,'anonymous_case',v_owner,NULL,v_auth,v_concept,
     NULL,'tablet',25,'mg','oral',NULL,NULL,v_time,v_time,v_end,
     v_schedule,ARRAY[]::text[],'Изменение учебной схемы',NULL,
     'c2-real-rpc-legacy-v2',v_exp
   );
   RAISE EXCEPTION 'archiving v2 without v1 was allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF EXISTS (SELECT 1 FROM public.medication_orders
   WHERE creation_idempotency_key='c2-real-rpc-legacy-v2') THEN
   RAISE EXCEPTION 'failed archive did not roll back original RPC';
 END IF;
 -- Force the archive insert to fail, not the medication RPC itself.
 ALTER TABLE clinical_medication_archive.order_history
 ADD CONSTRAINT integration_write_failure CHECK(action<>'activate') NOT VALID;
 BEGIN
   PERFORM public.clinical_activate_medication_order(
    'anonymous_case',v_owner,NULL,v_auth,v_concept,NULL,'tablet',
    25,'mg','oral',NULL,NULL,v_time,v_time,v_end,
    v_schedule,ARRAY[]::text[],'Тест отказа архива',NULL,
    'c2-real-rpc-archive-fail',v_exp
   );
   RAISE EXCEPTION 'archive write failure went unnoticed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF EXISTS (SELECT 1 FROM public.medication_orders
   WHERE creation_idempotency_key='c2-real-rpc-archive-fail') THEN
   RAISE EXCEPTION 'failed archive left a medication order';
 END IF;
 ALTER TABLE clinical_medication_archive.order_history DROP CONSTRAINT integration_write_failure;
END;
$archive_verify$;


ROLLBACK;
SELECT
 (SELECT count(*) FROM public.medication_orders WHERE creation_idempotency_key LIKE 'c2-smoke-%' OR creation_idempotency_key LIKE 'c2-real-rpc-%') AS remaining_synthetic_orders,
 (SELECT count(*) FROM clinical_medication_archive.order_history) AS remaining_archive_rows,
 to_regnamespace('clinical_medication_archive') IS NOT NULL AS persistent_staging_archive_exists;
