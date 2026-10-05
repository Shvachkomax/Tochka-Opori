BEGIN;
SELECT plan(51);

INSERT INTO public.patient_medication_orders (
  id, owner_type, owner_id, source_module, item_type, name,
  single_dose, dose_unit, frequency_type, times_per_day, start_date, ongoing
) VALUES (
  'b8000000-0000-4000-8000-000000000001',
  'anonymous_case', 'b8000000-0000-4000-8000-000000000002', 'support',
  'medication', 'synthetic-reference-test-order', 1, 'tablet', 'times_per_day', 1, current_date, true
);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.medication_reference_documents'::regclass), 'reference documents have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.medication_reference_snapshots'::regclass), 'reference snapshots have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.medication_reference_summaries'::regclass), 'reference summaries have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.patient_medication_reference_matches'::regclass), 'patient reference matches have RLS enabled');

SELECT ok(NOT has_table_privilege('anon', 'public.medication_reference_documents', 'SELECT') AND NOT has_table_privilege('anon', 'public.medication_reference_documents', 'INSERT') AND NOT has_table_privilege('anon', 'public.medication_reference_documents', 'UPDATE') AND NOT has_table_privilege('anon', 'public.medication_reference_documents', 'DELETE'), 'anon has no document table privileges');
SELECT ok(NOT has_table_privilege('authenticated', 'public.medication_reference_documents', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.medication_reference_documents', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.medication_reference_documents', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.medication_reference_documents', 'DELETE'), 'authenticated has no document table privileges');
SELECT ok(NOT has_table_privilege('anon', 'public.medication_reference_snapshots', 'SELECT') AND NOT has_table_privilege('anon', 'public.medication_reference_snapshots', 'INSERT') AND NOT has_table_privilege('anon', 'public.medication_reference_snapshots', 'UPDATE') AND NOT has_table_privilege('anon', 'public.medication_reference_snapshots', 'DELETE'), 'anon has no snapshot table privileges');
SELECT ok(NOT has_table_privilege('authenticated', 'public.medication_reference_snapshots', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.medication_reference_snapshots', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.medication_reference_snapshots', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.medication_reference_snapshots', 'DELETE'), 'authenticated has no snapshot table privileges');
SELECT ok(NOT has_table_privilege('anon', 'public.medication_reference_summaries', 'SELECT') AND NOT has_table_privilege('anon', 'public.medication_reference_summaries', 'INSERT') AND NOT has_table_privilege('anon', 'public.medication_reference_summaries', 'UPDATE') AND NOT has_table_privilege('anon', 'public.medication_reference_summaries', 'DELETE'), 'anon has no summary table privileges');
SELECT ok(NOT has_table_privilege('authenticated', 'public.medication_reference_summaries', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.medication_reference_summaries', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.medication_reference_summaries', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.medication_reference_summaries', 'DELETE'), 'authenticated has no summary table privileges');
SELECT ok(NOT has_table_privilege('anon', 'public.patient_medication_reference_matches', 'SELECT') AND NOT has_table_privilege('anon', 'public.patient_medication_reference_matches', 'INSERT') AND NOT has_table_privilege('anon', 'public.patient_medication_reference_matches', 'UPDATE') AND NOT has_table_privilege('anon', 'public.patient_medication_reference_matches', 'DELETE'), 'anon has no patient match table privileges');
SELECT ok(NOT has_table_privilege('authenticated', 'public.patient_medication_reference_matches', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.patient_medication_reference_matches', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.patient_medication_reference_matches', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.patient_medication_reference_matches', 'DELETE'), 'authenticated has no patient match table privileges');

SELECT ok(has_table_privilege('service_role', 'public.medication_reference_documents', 'SELECT'), 'service role can read reference documents');
SELECT ok(has_table_privilege('service_role', 'public.medication_reference_documents', 'INSERT'), 'service role can append reference documents');
SELECT ok(NOT has_table_privilege('service_role', 'public.medication_reference_documents', 'UPDATE'), 'service role cannot replace source documents');
SELECT ok(NOT has_table_privilege('service_role', 'public.medication_reference_documents', 'DELETE'), 'service role cannot delete source documents');
SELECT ok(has_table_privilege('service_role', 'public.medication_reference_snapshots', 'SELECT'), 'service role can read reference snapshots');
SELECT ok(has_table_privilege('service_role', 'public.medication_reference_snapshots', 'INSERT'), 'service role can append reference snapshots');
SELECT ok(NOT has_table_privilege('service_role', 'public.medication_reference_snapshots', 'UPDATE'), 'service role cannot update reference snapshots');
SELECT ok(NOT has_table_privilege('service_role', 'public.medication_reference_snapshots', 'DELETE'), 'service role cannot delete reference snapshots');
SELECT ok(has_table_privilege('service_role', 'public.medication_reference_summaries', 'SELECT'), 'service role can read reference summaries');
SELECT ok(has_table_privilege('service_role', 'public.medication_reference_summaries', 'INSERT'), 'service role can append reference summaries');
SELECT ok(NOT has_table_privilege('service_role', 'public.medication_reference_summaries', 'UPDATE'), 'service role cannot replace AI summaries');
SELECT ok(NOT has_table_privilege('service_role', 'public.medication_reference_summaries', 'DELETE'), 'service role cannot delete AI summaries');
SELECT ok(has_table_privilege('service_role', 'public.patient_medication_reference_matches', 'SELECT'), 'service role can read match history');
SELECT ok(has_table_privilege('service_role', 'public.patient_medication_reference_matches', 'INSERT'), 'service role can append match history');
SELECT ok(NOT has_table_privilege('service_role', 'public.patient_medication_reference_matches', 'UPDATE'), 'service role cannot update match history');
SELECT ok(NOT has_table_privilege('service_role', 'public.patient_medication_reference_matches', 'DELETE'), 'service role cannot delete match history');

SELECT ok(to_regclass('public.medication_reference_documents_provider_idx') IS NOT NULL, 'provider/document index exists');
SELECT ok(to_regclass('public.medication_reference_documents_verified_idx') IS NOT NULL, 'verified source partial index exists');
SELECT ok(to_regclass('public.medication_reference_snapshots_concept_idx') IS NOT NULL, 'concept snapshot index exists');
SELECT ok(to_regclass('public.patient_medication_reference_matches_order_idx') IS NOT NULL, 'patient match history index exists');

SET LOCAL ROLE service_role;
INSERT INTO public.patient_medication_orders (
  id, owner_type, owner_id, source_module, item_type, name,
  single_dose, dose_unit, frequency_type, times_per_day, start_date, ongoing
) VALUES (
  'b8000000-0000-4000-8000-000000000003',
  'anonymous_profile', 'b8000000-0000-4000-8000-000000000004', 'health',
  'medication', 'synthetic-reference-trigger-order', 1, 'tablet', 'times_per_day', 1, current_date, true
);
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.patient_medication_reference_matches WHERE medication_order_id = 'b8000000-0000-4000-8000-000000000003'), 1, 'service role insert records initial unresolved match state');
SELECT is((SELECT count(*)::integer FROM public.patient_medication_order_events WHERE medication_order_id = 'b8000000-0000-4000-8000-000000000003'), 1, 'existing patient order audit still records create');

INSERT INTO public.medication_concepts (
  id, concept_code, source_system, jurisdiction, canonical_name, display_name, concept_kind, status, test_only
) VALUES (
  'b8000000-0000-4000-8000-000000000010', 'medref.synthetic.test', 'internal', 'RU',
  'Synthetic reference test', 'Synthetic reference test', 'single_ingredient', 'active', true
);
SELECT ok((SELECT test_only FROM public.medication_concepts WHERE id = 'b8000000-0000-4000-8000-000000000010'), 'synthetic catalog fixture is explicitly test-only');
INSERT INTO public.medication_reference_documents (
  id, source_provider, source_document_id, canonical_identifier, source_title, source_version,
  retrieved_at, country, language, content_hash, verification_status, test_only, verified_at, verified_by
) VALUES (
  'b8000000-0000-4000-8000-000000000011', 'fixture', 'synthetic-doc-v1', 'fixture:synthetic-doc-v1',
  'Synthetic fixture document, not medical information', 'v1', now(), 'RU', 'ru', repeat('a', 64),
  'verified', true, now(), 'test-only-fixture'
);
INSERT INTO public.medication_reference_snapshots (
  id, source_document_id, medication_concept_id, snapshot_version, source_facts, content_hash, retrieved_at, test_only
) VALUES (
  'b8000000-0000-4000-8000-000000000012',
  'b8000000-0000-4000-8000-000000000011', 'b8000000-0000-4000-8000-000000000010',
  'v1', '{"mechanism_summary":"Synthetic fixture only; no medical content."}', repeat('b', 64), now(), true
);
INSERT INTO public.medication_reference_summaries (
  id, reference_snapshot_id, summary_language, summary_text, model_provider, model_name, prompt_version, test_only
) VALUES (
  'b8000000-0000-4000-8000-000000000013', 'b8000000-0000-4000-8000-000000000012',
  'ru', 'Synthetic summary fixture; not medical information.', 'fixture', 'fixture-model', 'test-v1', true
);
SELECT is((SELECT count(*)::integer FROM public.medication_reference_summaries WHERE id = 'b8000000-0000-4000-8000-000000000013'), 1, 'draft summary retains its exact source snapshot');

SELECT throws_ok(
  $$INSERT INTO public.medication_reference_snapshots (
      source_document_id, medication_concept_id, snapshot_version, source_facts, content_hash, retrieved_at, test_only
    ) VALUES (
      'b8000000-0000-4000-8000-000000000011', 'b8000000-0000-4000-8000-000000000010',
      'mismatched-test', '{}', repeat('c', 64), now(), false
    )$$,
  '23514', 'Snapshot test_only must match its source document',
  'test-only document cannot produce a non-test snapshot'
);
SELECT throws_ok(
  $$INSERT INTO public.medication_reference_summaries (
      reference_snapshot_id, summary_language, summary_text, model_provider, model_name,
      prompt_version, review_status, test_only, reviewed_at, reviewed_by
    ) VALUES (
      'b8000000-0000-4000-8000-000000000012', 'ru', 'Synthetic summary', 'fixture',
      'fixture-model', 'test-v1', 'reviewed', true, now(), 'test-reviewer'
    )$$,
  '42501', 'Only reviewed summaries of verified non-test sources may be used',
  'test-only source summary cannot become AI-eligible'
);
SELECT throws_ok(
  $$UPDATE public.patient_medication_orders SET
      medication_concept_id = 'b8000000-0000-4000-8000-000000000010',
      reference_status = 'verified', reference_confidence = 1,
      reference_matched_by = 'curator', reference_match_method = 'test',
      reference_matched_at = now(), reference_source_provider = 'fixture',
      reference_source_snapshot_id = 'b8000000-0000-4000-8000-000000000012'
    WHERE id = 'b8000000-0000-4000-8000-000000000001'$$,
  '23514', 'Verified medication reference requires a verified non-test source snapshot',
  'test-only source cannot verify a patient order'
);
SELECT throws_ok(
  $$INSERT INTO public.patient_medication_reference_matches (
      medication_order_id, owner_type, owner_id, reference_status, medication_concept_id,
      matched_by, match_method, source_provider, reference_snapshot_id
    ) VALUES (
      'b8000000-0000-4000-8000-000000000001', 'anonymous_case', 'b8000000-0000-4000-8000-000000000002',
      'verified', 'b8000000-0000-4000-8000-000000000010', 'curator', 'test', 'fixture',
      'b8000000-0000-4000-8000-000000000012'
    )$$,
  '23514', 'Verified match event requires a verified non-test source snapshot',
  'test-only source cannot create a verified match event'
);
INSERT INTO public.patient_medication_orders (
  id, owner_type, owner_id, source_module, item_type, name,
  single_dose, dose_unit, frequency_type, start_date, ongoing
) VALUES (
  'b8000000-0000-4000-8000-000000000021',
  'anonymous_case', 'b8000000-0000-4000-8000-000000000002', 'support',
  'supplement', 'synthetic-reference-test-supplement', 1, 'capsule', 'as_needed', current_date, true
);
SELECT throws_ok(
  $$UPDATE public.patient_medication_orders SET
      reference_status = 'candidate', reference_candidate_concepts = '[{"medication_concept_id":"b8000000-0000-4000-8000-000000000010"}]',
      reference_confidence = 1, reference_match_method = 'test', reference_source_provider = 'fixture'
    WHERE id = 'b8000000-0000-4000-8000-000000000021'$$,
  '23514', NULL,
  'supplement cannot link to a medication concept'
);
SELECT throws_ok(
  $$INSERT INTO public.medication_orders (id, medication_concept_id) VALUES ('b8000000-0000-4000-8000-000000000020', 'b8000000-0000-4000-8000-000000000010')$$,
  '23514', 'Test-only medication concepts cannot back clinician orders',
  'test-only concept cannot become a clinician-authored order'
);

SELECT throws_ok(
  $$INSERT INTO public.patient_medication_reference_matches (
      medication_order_id, owner_type, owner_id, reference_status,
      medication_concept_id, matched_by, match_method
    ) VALUES (
      'b8000000-0000-4000-8000-000000000001', 'anonymous_case',
      'b8000000-0000-4000-8000-000000000099', 'matched',
      'b8000000-0000-4000-8000-000000000010', 'patient', 'test'
    )$$,
  '23503', NULL,
  'reference match owner must match patient order owner'
);

SELECT throws_ok($$UPDATE public.medication_reference_documents SET source_title = 'changed' WHERE id = 'b8000000-0000-4000-8000-000000000011'$$, '55000', 'patient medication audit records are append-only', 'source documents are append-only');
SELECT throws_ok($$DELETE FROM public.medication_reference_documents WHERE id = 'b8000000-0000-4000-8000-000000000011'$$, '55000', 'patient medication audit records are append-only', 'source documents cannot be deleted');
SELECT throws_ok($$UPDATE public.medication_reference_snapshots SET snapshot_version = 'changed' WHERE id = 'b8000000-0000-4000-8000-000000000012'$$, '55000', 'patient medication audit records are append-only', 'source snapshots are append-only');
SELECT throws_ok($$DELETE FROM public.medication_reference_snapshots WHERE id = 'b8000000-0000-4000-8000-000000000012'$$, '55000', 'patient medication audit records are append-only', 'source snapshots cannot be deleted');
SELECT throws_ok($$UPDATE public.medication_reference_summaries SET summary_text = 'changed' WHERE id = 'b8000000-0000-4000-8000-000000000013'$$, '55000', 'patient medication audit records are append-only', 'AI summaries are append-only');
SELECT throws_ok($$DELETE FROM public.medication_reference_summaries WHERE id = 'b8000000-0000-4000-8000-000000000013'$$, '55000', 'patient medication audit records are append-only', 'AI summaries cannot be deleted');
SELECT throws_ok($$UPDATE public.patient_medication_reference_matches SET reference_status = 'matched' WHERE medication_order_id = 'b8000000-0000-4000-8000-000000000001'$$, '55000', 'patient medication audit records are append-only', 'match history is append-only');
SELECT throws_ok($$DELETE FROM public.patient_medication_reference_matches WHERE medication_order_id = 'b8000000-0000-4000-8000-000000000001'$$, '55000', 'patient medication audit records are append-only', 'match history cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
