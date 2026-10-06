-- Medication reference runtime smoke tests for TEST (eehyehlhiyztciaezaus) only.
-- Reproducible companion to PostgREST runtime checks; run manually via a
-- confirmed SQL channel. Every assertion is transactional: the script ends
-- with ROLLBACK and leaves no rows behind.
--
-- Usage: psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f scripts/test-medication-reference-runtime-smoke.sql
--
-- Assertions raise EXCEPTION on failure; success prints one marker per section.

BEGIN;

DO $$
BEGIN
  IF current_database() IS NULL THEN
    RAISE EXCEPTION 'no database selected';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Section 0: migration history (reproducibility only)
-- Expected: 20261005234912 medication_reference_layer registered,
--           20261005130717 absent.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_applied bigint;
  v_stale bigint;
BEGIN
  SELECT count(*) INTO v_applied
  FROM supabase_migrations.schema_migrations
  WHERE version = '20261005234912';
  IF v_applied <> 1 THEN
    RAISE EXCEPTION 'migration 20261005234912 is not registered exactly once';
  END IF;
  SELECT count(*) INTO v_stale
  FROM supabase_migrations.schema_migrations
  WHERE version = '20261005130717';
  IF v_stale <> 0 THEN
    RAISE EXCEPTION 'stale migration 20261005130717 is still registered';
  END IF;
  RAISE NOTICE 'PASS migration history';
END $$;

-- ---------------------------------------------------------------------------
-- Fixtures: synthetic data only.
-- ---------------------------------------------------------------------------
INSERT INTO public.medication_concepts (
  id, concept_code, source_system, jurisdiction, canonical_name, display_name,
  concept_kind, status, test_only
) VALUES (
  'b8000000-0000-4000-8000-00000000b001', 'medref.smoke.test', 'internal', 'RU',
  'Synthetic smoke test concept', 'Synthetic smoke test concept',
  'single_ingredient', 'active', true
), (
  'b8000000-0000-4000-8000-00000000b002', 'medref.smoke.real', 'internal', 'RU',
  'Synthetic smoke real concept', 'Synthetic smoke real concept',
  'single_ingredient', 'active', false
), (
  'b8000000-0000-4000-8000-00000000b003', 'medref.smoke.unused', 'internal', 'RU',
  'Synthetic smoke unused concept', 'Synthetic smoke unused concept',
  'single_ingredient', 'active', false
);

INSERT INTO public.medication_reference_documents (
  id, source_provider, source_document_id, canonical_identifier, source_title,
  source_version, retrieved_at, country, language, content_hash,
  verification_status, test_only, verified_at, verified_by
) VALUES (
  'b8000000-0000-4000-8000-00000000b011', 'fixture', 'smoke-test-doc', 'fixture:smoke-test-doc',
  'Synthetic smoke test document, not medical information', 'v1', now(), 'RU', 'ru',
  repeat('a', 64), 'verified', true, now(), 'smoke-test-only-fixture'
), (
  'b8000000-0000-4000-8000-00000000b012', 'fixture', 'smoke-real-doc', 'fixture:smoke-real-doc',
  'Synthetic smoke real document, not medical information', 'v1', now(), 'RU', 'ru',
  repeat('c', 64), 'verified', false, now(), 'smoke-verification'
);

INSERT INTO public.medication_reference_snapshots (
  id, source_document_id, medication_concept_id, snapshot_version, source_facts,
  content_hash, retrieved_at, test_only
) VALUES (
  'b8000000-0000-4000-8000-00000000b021',
  'b8000000-0000-4000-8000-00000000b011', 'b8000000-0000-4000-8000-00000000b001',
  'v1', '{"mechanism_summary":"Synthetic smoke test fixture only."}', repeat('b', 64), now(), true
), (
  'b8000000-0000-4000-8000-00000000b022',
  'b8000000-0000-4000-8000-00000000b012', 'b8000000-0000-4000-8000-00000000b002',
  'v1', '{"mechanism_summary":"Synthetic smoke real fixture only."}', repeat('d', 64), now(), false
);

INSERT INTO public.medication_reference_summaries (
  id, reference_snapshot_id, summary_language, summary_text, model_provider,
  model_name, prompt_version, test_only
) VALUES (
  'b8000000-0000-4000-8000-00000000b031',
  'b8000000-0000-4000-8000-00000000b021', 'ru',
  'Synthetic smoke test summary; not medical information.', 'fixture', 'fixture-model',
  'smoke-v1', true
), (
  'b8000000-0000-4000-8000-00000000b032',
  'b8000000-0000-4000-8000-00000000b022', 'ru',
  'Synthetic smoke real summary; not medical information.', 'fixture', 'fixture-model',
  'smoke-v1', false
);

INSERT INTO public.patient_medication_orders (
  id, owner_type, owner_id, source_module, item_type, name,
  single_dose, dose_unit, frequency_type, times_per_day, start_date, ongoing
) VALUES (
  'b8000000-0000-4000-8000-00000000b041', 'anonymous_profile',
  'b8000000-0000-4000-8000-00000000b051', 'health', 'medication',
  'Синтетик-Тест  50 мг (SQL smoke)', 50, 'мг', 'times_per_day', 1, current_date, true
), (
  'b8000000-0000-4000-8000-00000000b042', 'anonymous_case',
  'b8000000-0000-4000-8000-00000000b052', 'support', 'supplement',
  'Synthetic smoke supplement', 1, 'capsule', 'as_needed', NULL, current_date, true
);

-- ---------------------------------------------------------------------------
-- Section 1: patient order text is preserved verbatim
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT name INTO v_name FROM public.patient_medication_orders
  WHERE id = 'b8000000-0000-4000-8000-00000000b041';
  IF v_name IS DISTINCT FROM 'Синтетик-Тест  50 мг (SQL smoke)' THEN
    RAISE EXCEPTION 'patient order text was rewritten: %', v_name;
  END IF;
  RAISE NOTICE 'PASS patient order text preserved';
END $$;

-- ---------------------------------------------------------------------------
-- Section 2-3: exact candidate is recorded; candidate never auto-matches
-- ---------------------------------------------------------------------------
UPDATE public.patient_medication_orders SET
  reference_status = 'candidate',
  reference_candidate_concepts = '[{"medication_concept_id":"b8000000-0000-4000-8000-00000000b002","confidence":1,"confidence_method":"exact_normalized_name"}]',
  reference_confidence = 1,
  reference_match_method = 'exact_normalized_name',
  reference_source_provider = 'internal'
WHERE id = 'b8000000-0000-4000-8000-00000000b041';

DO $$
DECLARE
  v_status text;
  v_concept uuid;
  v_matched bigint;
BEGIN
  SELECT reference_status, medication_concept_id INTO v_status, v_concept
  FROM public.patient_medication_orders
  WHERE id = 'b8000000-0000-4000-8000-00000000b041';
  IF v_status <> 'candidate' OR v_concept IS NOT NULL THEN
    RAISE EXCEPTION 'candidate state drifted: status=% concept=%', v_status, v_concept;
  END IF;
  SELECT count(*) INTO v_matched
  FROM public.patient_medication_reference_matches
  WHERE medication_order_id = 'b8000000-0000-4000-8000-00000000b041'
    AND reference_status IN ('matched', 'verified');
  IF v_matched <> 0 THEN
    RAISE EXCEPTION 'auto-matched without explicit confirmation: % rows', v_matched;
  END IF;
  RAISE NOTICE 'PASS candidate recorded, never auto-matched';
END $$;

-- ---------------------------------------------------------------------------
-- Section 5: fail-closed reference states
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE public.patient_medication_orders SET
      reference_status = 'candidate',
      reference_candidate_concepts = '[{"medication_concept_id":"b8000000-0000-4000-8000-00000000b002"}]',
      reference_match_method = 'explicit', reference_source_provider = 'internal'
    WHERE id = 'b8000000-0000-4000-8000-00000000b042';
    RAISE EXCEPTION 'supplement reached a medication candidate state';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.patient_medication_orders SET
      reference_status = 'verified', medication_concept_id = 'b8000000-0000-4000-8000-00000000b002',
      reference_matched_by = 'patient', reference_matched_at = now(),
      reference_match_method = 'explicit', reference_source_provider = 'internal'
    WHERE id = 'b8000000-0000-4000-8000-00000000b041';
    RAISE EXCEPTION 'verified state accepted without a source snapshot';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.patient_medication_orders SET
      reference_status = 'matched', medication_concept_id = 'b8000000-0000-4000-8000-00000000b002'
    WHERE id = 'b8000000-0000-4000-8000-00000000b041';
    RAISE EXCEPTION 'matched state accepted without confirmation metadata';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.patient_medication_orders SET
      reference_status = 'matched', medication_concept_id = 'b8000000-0000-4000-8000-00000000b001',
      reference_matched_by = 'patient', reference_matched_at = now(),
      reference_match_method = 'explicit', reference_source_provider = 'internal'
    WHERE id = 'b8000000-0000-4000-8000-00000000b041';
    RAISE EXCEPTION 'matched state accepted a test-only concept';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.patient_medication_orders SET
      reference_status = 'verified', medication_concept_id = 'b8000000-0000-4000-8000-00000000b001',
      reference_matched_by = 'patient', reference_matched_at = now(),
      reference_match_method = 'explicit', reference_source_provider = 'fixture',
      reference_source_snapshot_id = 'b8000000-0000-4000-8000-00000000b021'
    WHERE id = 'b8000000-0000-4000-8000-00000000b041';
    RAISE EXCEPTION 'verified state accepted a test-only snapshot';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS fail-closed reference states';
END $$;

-- ---------------------------------------------------------------------------
-- Section 8: verified non-test snapshot is visible to loader predicates;
--            test-only snapshots stay hidden (loadVerifiedMedicationReferences
--            WHERE test_only = false AND verification_status = 'verified')
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_visible bigint;
  v_hidden bigint;
BEGIN
  SELECT count(*) INTO v_visible
  FROM public.medication_reference_snapshots s
  JOIN public.medication_reference_documents d ON d.id = s.source_document_id
  WHERE s.id = 'b8000000-0000-4000-8000-00000000b022'
    AND s.test_only = false
    AND d.verification_status = 'verified'
    AND d.test_only = false
    AND s.medication_concept_id = 'b8000000-0000-4000-8000-00000000b002';
  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'verified non-test snapshot is not visible to loader predicates';
  END IF;
  SELECT count(*) INTO v_hidden
  FROM public.medication_reference_snapshots s
  JOIN public.medication_reference_documents d ON d.id = s.source_document_id
  WHERE s.id = 'b8000000-0000-4000-8000-00000000b021'
    AND s.test_only = false
    AND d.verification_status = 'verified'
    AND d.test_only = false;
  IF v_hidden <> 0 THEN
    RAISE EXCEPTION 'test-only snapshot leaked through loader predicates';
  END IF;
  RAISE NOTICE 'PASS loader visibility (verified non-test only)';
END $$;

-- ---------------------------------------------------------------------------
-- Section 9: snapshot and version provenance is preserved
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_snapshot public.medication_reference_snapshots%ROWTYPE;
  v_provider text;
  v_doc_version text;
BEGIN
  SELECT * INTO v_snapshot FROM public.medication_reference_snapshots
  WHERE id = 'b8000000-0000-4000-8000-00000000b022';
  IF v_snapshot.snapshot_version <> 'v1'
     OR v_snapshot.content_hash <> repeat('d', 64)
     OR v_snapshot.source_document_id <> 'b8000000-0000-4000-8000-00000000b012'
     OR v_snapshot.medication_concept_id <> 'b8000000-0000-4000-8000-00000000b002' THEN
    RAISE EXCEPTION 'snapshot provenance drifted';
  END IF;
  SELECT source_provider, source_version INTO v_provider, v_doc_version
  FROM public.medication_reference_documents
  WHERE id = v_snapshot.source_document_id;
  IF v_provider IS DISTINCT FROM 'fixture' OR v_doc_version IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'document provenance drifted';
  END IF;
  RAISE NOTICE 'PASS snapshot/version provenance preserved';
END $$;

-- ---------------------------------------------------------------------------
-- Section 10: AI summary is stored separately from source facts
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facts jsonb;
  v_summary text;
BEGIN
  SELECT source_facts INTO v_facts FROM public.medication_reference_snapshots
  WHERE id = 'b8000000-0000-4000-8000-00000000b022';
  SELECT summary_text INTO v_summary FROM public.medication_reference_summaries
  WHERE id = 'b8000000-0000-4000-8000-00000000b032';
  IF v_facts->>'mechanism_summary' IS DISTINCT FROM 'Synthetic smoke real fixture only.' THEN
    RAISE EXCEPTION 'source facts were mutated by summary flow';
  END IF;
  IF v_summary IS DISTINCT FROM 'Synthetic smoke real summary; not medical information.' THEN
    RAISE EXCEPTION 'summary text missing from its own record';
  END IF;
  IF v_facts ? 'summary' OR v_facts ? 'summary_text' THEN
    RAISE EXCEPTION 'AI summary leaked into source facts';
  END IF;
  RAISE NOTICE 'PASS AI summary separated from source facts';
END $$;

-- ---------------------------------------------------------------------------
-- Section 11: append-only semantics at trigger level (55000)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE public.medication_reference_documents SET source_title = 'changed'
    WHERE id = 'b8000000-0000-4000-8000-00000000b012';
    RAISE EXCEPTION 'source document accepted an update';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM public.medication_reference_snapshots
    WHERE id = 'b8000000-0000-4000-8000-00000000b022';
    RAISE EXCEPTION 'snapshot accepted a delete';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE public.medication_reference_summaries SET summary_text = 'changed'
    WHERE id = 'b8000000-0000-4000-8000-00000000b032';
    RAISE EXCEPTION 'summary accepted an update';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  RAISE NOTICE 'PASS append-only triggers (55000)';
END $$;

-- ---------------------------------------------------------------------------
-- Section 13: owner isolation via composite owner FK (23503)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.patient_medication_reference_matches (
      medication_order_id, owner_type, owner_id, reference_status,
      candidate_concepts, match_method, source_provider
    ) VALUES (
      'b8000000-0000-4000-8000-00000000b041', 'anonymous_profile',
      'b8000000-0000-4000-8000-00000000b059', 'candidate',
      '[{"medication_concept_id":"b8000000-0000-4000-8000-00000000b002"}]',
      'explicit', 'internal'
    );
    RAISE EXCEPTION 'match history accepted a foreign owner';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS owner isolation (composite FK)';
END $$;

-- ---------------------------------------------------------------------------
-- Section 14: test-only concept immutability after first use (23514)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE public.medication_concepts SET test_only = false
    WHERE id = 'b8000000-0000-4000-8000-00000000b001';
    RAISE EXCEPTION 'used concept test_only changed';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  UPDATE public.medication_concepts SET test_only = true
  WHERE id = 'b8000000-0000-4000-8000-00000000b003';
  IF (SELECT test_only FROM public.medication_concepts
      WHERE id = 'b8000000-0000-4000-8000-00000000b003') <> true THEN
    RAISE EXCEPTION 'unused concept test_only could not be changed';
  END IF;
  RAISE NOTICE 'PASS concept test_only immutability';
END $$;

ROLLBACK;
