-- Provider-neutral, versioned medication reference data.
-- Reuses C2 medication_concepts; patient-entered order text remains canonical for the report.

ALTER TABLE public.medication_concepts
  ADD COLUMN test_only boolean NOT NULL DEFAULT false;
CREATE INDEX medication_concepts_reference_search_idx
  ON public.medication_concepts (jurisdiction, status, test_only, lower(display_name));
COMMENT ON COLUMN public.medication_concepts.test_only IS 'Test-only concepts are excluded from patient matching and clinician orders.';

CREATE TABLE public.medication_reference_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provider text NOT NULL CHECK (length(btrim(source_provider)) > 0),
  source_document_id text NOT NULL CHECK (length(btrim(source_document_id)) > 0),
  source_url text,
  canonical_identifier text,
  source_title text NOT NULL CHECK (length(btrim(source_title)) > 0),
  source_version text NOT NULL CHECK (length(btrim(source_version)) > 0),
  published_at timestamptz,
  effective_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  country text NOT NULL CHECK (length(btrim(country)) > 0),
  language text NOT NULL CHECK (length(btrim(language)) > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'rejected', 'retired')),
  test_only boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_reference_documents_locator_check
    CHECK (source_url IS NOT NULL OR canonical_identifier IS NOT NULL),
  CONSTRAINT medication_reference_documents_url_check
    CHECK (source_url IS NULL OR source_url LIKE 'https://%'),
  CONSTRAINT medication_reference_documents_verified_check
    CHECK (verification_status <> 'verified' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL AND length(btrim(verified_by)) > 0)),
  UNIQUE (source_provider, source_document_id, source_version, content_hash, verification_status, test_only)
);

CREATE INDEX medication_reference_documents_provider_idx
  ON public.medication_reference_documents (source_provider, source_document_id, source_version DESC);
CREATE INDEX medication_reference_documents_verified_idx
  ON public.medication_reference_documents (source_provider, country, language, retrieved_at DESC)
  WHERE verification_status = 'verified' AND test_only = false;

CREATE TABLE public.medication_reference_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL
    REFERENCES public.medication_reference_documents(id) ON DELETE RESTRICT,
  medication_concept_id uuid NOT NULL
    REFERENCES public.medication_concepts(id) ON DELETE RESTRICT,
  snapshot_version text NOT NULL CHECK (length(btrim(snapshot_version)) > 0),
  source_facts jsonb NOT NULL CHECK (jsonb_typeof(source_facts) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  retrieved_at timestamptz NOT NULL,
  test_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_reference_snapshots_fact_keys_check CHECK (
    source_facts - ARRAY[
      'trade_name', 'active_ingredient', 'dosage_form', 'strength', 'atc_code',
      'pharmacological_group', 'indications', 'contraindications', 'adverse_effects',
      'interactions', 'mechanism_summary', 'special_warnings',
      'pregnancy_lactation', 'overdose_information'
    ]::text[] = '{}'::jsonb
  ),
  UNIQUE (source_document_id, medication_concept_id, content_hash),
  UNIQUE (id, medication_concept_id)
);

CREATE INDEX medication_reference_snapshots_concept_idx
  ON public.medication_reference_snapshots (medication_concept_id, retrieved_at DESC);
CREATE INDEX medication_reference_snapshots_document_idx
  ON public.medication_reference_snapshots (source_document_id, created_at DESC);

CREATE TABLE public.medication_reference_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_snapshot_id uuid NOT NULL
    REFERENCES public.medication_reference_snapshots(id) ON DELETE RESTRICT,
  summary_language text NOT NULL CHECK (length(btrim(summary_language)) > 0),
  summary_text text NOT NULL CHECK (length(btrim(summary_text)) > 0),
  model_provider text NOT NULL CHECK (length(btrim(model_provider)) > 0),
  model_name text NOT NULL CHECK (length(btrim(model_name)) > 0),
  model_version text,
  prompt_version text NOT NULL CHECK (length(btrim(prompt_version)) > 0),
  review_status text NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'reviewed', 'rejected')),
  test_only boolean NOT NULL DEFAULT true,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_reference_summaries_review_check
    CHECK (review_status <> 'reviewed' OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND length(btrim(reviewed_by)) > 0))
);

CREATE INDEX medication_reference_summaries_snapshot_idx
  ON public.medication_reference_summaries (reference_snapshot_id, review_status, created_at DESC);

ALTER TABLE public.patient_medication_orders
  ADD COLUMN medication_concept_id uuid REFERENCES public.medication_concepts(id) ON DELETE RESTRICT,
  ADD COLUMN reference_status text NOT NULL DEFAULT 'unresolved',
  ADD COLUMN reference_candidate_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN reference_confidence numeric,
  ADD COLUMN reference_matched_by text,
  ADD COLUMN reference_match_method text,
  ADD COLUMN reference_matched_at timestamptz,
  ADD COLUMN reference_source_provider text,
  ADD COLUMN reference_source_snapshot_id uuid;

ALTER TABLE public.patient_medication_orders
  ADD CONSTRAINT patient_medication_orders_reference_status_check
    CHECK (reference_status IN ('unresolved', 'candidate', 'matched', 'verified', 'ambiguous')),
  ADD CONSTRAINT patient_medication_orders_reference_candidates_check
    CHECK (jsonb_typeof(reference_candidate_concepts) = 'array'),
  ADD CONSTRAINT patient_medication_orders_reference_confidence_check
    CHECK (reference_confidence IS NULL OR (reference_confidence >= 0 AND reference_confidence <= 1)),
  ADD CONSTRAINT patient_medication_orders_reference_item_type_check
    CHECK (item_type = 'medication' OR reference_status = 'unresolved'),
  ADD CONSTRAINT patient_medication_orders_reference_state_check CHECK (
    (reference_status = 'unresolved'
      AND medication_concept_id IS NULL AND reference_source_snapshot_id IS NULL
      AND reference_matched_by IS NULL AND reference_match_method IS NULL
      AND reference_matched_at IS NULL AND reference_source_provider IS NULL
      AND reference_confidence IS NULL AND jsonb_array_length(reference_candidate_concepts) = 0)
    OR
    (reference_status = 'candidate'
      AND medication_concept_id IS NULL AND reference_source_snapshot_id IS NULL
      AND reference_matched_by IS NULL AND reference_matched_at IS NULL
      AND reference_match_method IS NOT NULL AND length(btrim(reference_match_method)) > 0
      AND reference_source_provider IS NOT NULL AND length(btrim(reference_source_provider)) > 0
      AND jsonb_array_length(reference_candidate_concepts) = 1)
    OR
    (reference_status = 'ambiguous'
      AND medication_concept_id IS NULL AND reference_source_snapshot_id IS NULL
      AND reference_matched_by IS NULL AND reference_matched_at IS NULL
      AND reference_match_method IS NOT NULL AND length(btrim(reference_match_method)) > 0
      AND reference_source_provider IS NOT NULL AND length(btrim(reference_source_provider)) > 0
      AND jsonb_array_length(reference_candidate_concepts) > 1)
    OR
    (reference_status = 'matched'
      AND medication_concept_id IS NOT NULL AND reference_source_snapshot_id IS NULL
      AND reference_matched_by IS NOT NULL AND length(btrim(reference_matched_by)) > 0 AND reference_matched_at IS NOT NULL
      AND reference_match_method IS NOT NULL AND length(btrim(reference_match_method)) > 0
      AND reference_source_provider IS NOT NULL AND length(btrim(reference_source_provider)) > 0)
    OR
    (reference_status = 'verified'
      AND medication_concept_id IS NOT NULL AND reference_source_snapshot_id IS NOT NULL
      AND reference_matched_by IS NOT NULL AND length(btrim(reference_matched_by)) > 0 AND reference_matched_at IS NOT NULL
      AND reference_match_method IS NOT NULL AND length(btrim(reference_match_method)) > 0
      AND reference_source_provider IS NOT NULL AND length(btrim(reference_source_provider)) > 0)
  );

ALTER TABLE public.patient_medication_orders
  ADD CONSTRAINT patient_medication_orders_reference_snapshot_concept_fk
    FOREIGN KEY (reference_source_snapshot_id, medication_concept_id)
    REFERENCES public.medication_reference_snapshots (id, medication_concept_id) ON DELETE RESTRICT;

CREATE INDEX patient_medication_orders_reference_idx
  ON public.patient_medication_orders (owner_type, owner_id, source_module, reference_status, medication_concept_id);
CREATE INDEX patient_medication_orders_reference_concept_fk_idx
  ON public.patient_medication_orders (medication_concept_id)
  WHERE medication_concept_id IS NOT NULL;
CREATE INDEX patient_medication_orders_reference_snapshot_fk_idx
  ON public.patient_medication_orders (reference_source_snapshot_id, medication_concept_id)
  WHERE reference_source_snapshot_id IS NOT NULL;

CREATE TABLE public.patient_medication_reference_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_order_id uuid NOT NULL,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  reference_status text NOT NULL
    CHECK (reference_status IN ('unresolved', 'candidate', 'matched', 'verified', 'ambiguous')),
  candidate_concepts jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(candidate_concepts) = 'array'),
  medication_concept_id uuid REFERENCES public.medication_concepts(id) ON DELETE RESTRICT,
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  matched_by text,
  match_method text,
  source_provider text,
  reference_snapshot_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_medication_reference_matches_owner_fk
    FOREIGN KEY (medication_order_id, owner_type, owner_id)
    REFERENCES public.patient_medication_orders (id, owner_type, owner_id) ON DELETE RESTRICT,
  CONSTRAINT patient_medication_reference_matches_snapshot_concept_fk
    FOREIGN KEY (reference_snapshot_id, medication_concept_id)
    REFERENCES public.medication_reference_snapshots (id, medication_concept_id) ON DELETE RESTRICT,
  CONSTRAINT patient_medication_reference_matches_state_check CHECK (
    (reference_status = 'unresolved' AND medication_concept_id IS NULL AND reference_snapshot_id IS NULL
      AND confidence IS NULL AND matched_by IS NULL AND match_method IS NULL AND source_provider IS NULL
      AND jsonb_array_length(candidate_concepts) = 0)
    OR (reference_status = 'candidate' AND medication_concept_id IS NULL AND reference_snapshot_id IS NULL
      AND matched_by IS NULL AND match_method IS NOT NULL AND source_provider IS NOT NULL
      AND jsonb_array_length(candidate_concepts) = 1)
    OR (reference_status = 'ambiguous' AND medication_concept_id IS NULL AND reference_snapshot_id IS NULL
      AND matched_by IS NULL AND match_method IS NOT NULL AND source_provider IS NOT NULL
      AND jsonb_array_length(candidate_concepts) > 1)
    OR (reference_status = 'matched' AND medication_concept_id IS NOT NULL AND reference_snapshot_id IS NULL
      AND matched_by IS NOT NULL AND match_method IS NOT NULL AND source_provider IS NOT NULL)
    OR (reference_status = 'verified' AND medication_concept_id IS NOT NULL AND reference_snapshot_id IS NOT NULL
      AND matched_by IS NOT NULL AND match_method IS NOT NULL AND source_provider IS NOT NULL)
  ),
  CONSTRAINT patient_medication_reference_matches_verified_check CHECK (
    reference_status <> 'verified' OR (reference_snapshot_id IS NOT NULL AND source_provider IS NOT NULL)
  )
);

CREATE INDEX patient_medication_reference_matches_order_idx
  ON public.patient_medication_reference_matches (medication_order_id, created_at DESC);
CREATE INDEX patient_medication_reference_matches_owner_idx
  ON public.patient_medication_reference_matches (owner_type, owner_id, created_at DESC);
CREATE INDEX patient_medication_reference_matches_concept_fk_idx
  ON public.patient_medication_reference_matches (medication_concept_id)
  WHERE medication_concept_id IS NOT NULL;
CREATE INDEX patient_medication_reference_matches_snapshot_fk_idx
  ON public.patient_medication_reference_matches (reference_snapshot_id, medication_concept_id)
  WHERE reference_snapshot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_medication_reference_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_document_test_only boolean;
  v_concept_test_only boolean;
BEGIN
  SELECT test_only INTO v_document_test_only
  FROM public.medication_reference_documents
  WHERE id = NEW.source_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reference source document does not exist' USING ERRCODE = '23503';
  END IF;
  SELECT test_only INTO v_concept_test_only
  FROM public.medication_concepts
  WHERE id = NEW.medication_concept_id;
  IF NOT FOUND OR v_document_test_only IS DISTINCT FROM NEW.test_only
     OR v_concept_test_only IS DISTINCT FROM NEW.test_only THEN
    RAISE EXCEPTION 'Snapshot test_only must match its source and concept' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_medication_reference_summary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_snapshot_test_only boolean;
  v_document_status text;
  v_document_test_only boolean;
BEGIN
  SELECT s.test_only, d.verification_status, d.test_only
    INTO v_snapshot_test_only, v_document_status, v_document_test_only
  FROM public.medication_reference_snapshots s
  JOIN public.medication_reference_documents d ON d.id = s.source_document_id
  WHERE s.id = NEW.reference_snapshot_id;
  IF NOT FOUND OR v_snapshot_test_only IS DISTINCT FROM NEW.test_only
     OR (NEW.review_status = 'reviewed' AND (v_document_status <> 'verified' OR v_document_test_only)) THEN
    RAISE EXCEPTION 'Summary provenance is not eligible for its review status' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_patient_medication_verified_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_source_provider text;
  v_verification_status text;
  v_test_only boolean;
BEGIN
  IF NEW.reference_status = 'matched' AND EXISTS (
    SELECT 1 FROM public.medication_concepts
    WHERE id = NEW.medication_concept_id AND test_only
  ) THEN
    RAISE EXCEPTION 'Test-only medication concepts cannot be matched to patient orders' USING ERRCODE = '23514';
  END IF;
  IF NEW.reference_status <> 'verified' THEN RETURN NEW; END IF;
  SELECT d.source_provider, d.verification_status, (d.test_only OR s.test_only OR c.test_only)
    INTO v_source_provider, v_verification_status, v_test_only
  FROM public.medication_reference_snapshots s
  JOIN public.medication_reference_documents d ON d.id = s.source_document_id
  JOIN public.medication_concepts c ON c.id = s.medication_concept_id
  WHERE s.id = NEW.reference_source_snapshot_id
    AND s.medication_concept_id = NEW.medication_concept_id;
  IF NOT FOUND OR v_verification_status <> 'verified' OR v_test_only
     OR v_source_provider IS DISTINCT FROM NEW.reference_source_provider THEN
    RAISE EXCEPTION 'Verified medication reference requires a verified non-test source snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_test_only_clinician_medication_concept()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.medication_concepts
    WHERE id = NEW.medication_concept_id AND test_only
  ) THEN
    RAISE EXCEPTION 'Test-only medication concepts cannot back clinician orders' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_medication_concept_test_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.test_only IS NOT DISTINCT FROM OLD.test_only THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
      SELECT 1 FROM public.medication_reference_snapshots
      WHERE medication_concept_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM public.patient_medication_orders
      WHERE medication_concept_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM public.patient_medication_reference_matches
      WHERE medication_concept_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM public.medication_orders
      WHERE medication_concept_id = OLD.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.patient_medication_orders o,
           jsonb_array_elements(o.reference_candidate_concepts) AS candidate
      WHERE candidate->>'medication_concept_id' = OLD.id::text
    )
    OR EXISTS (
      SELECT 1
      FROM public.patient_medication_reference_matches m,
           jsonb_array_elements(m.candidate_concepts) AS candidate
      WHERE candidate->>'medication_concept_id' = OLD.id::text
    ) THEN
    RAISE EXCEPTION 'Medication concept test_only is immutable after first use' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_patient_medication_reference_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     ROW(OLD.reference_status, OLD.reference_candidate_concepts, OLD.medication_concept_id,
         OLD.reference_confidence, OLD.reference_matched_by, OLD.reference_match_method,
         OLD.reference_source_provider, OLD.reference_source_snapshot_id)
     IS NOT DISTINCT FROM
     ROW(NEW.reference_status, NEW.reference_candidate_concepts, NEW.medication_concept_id,
         NEW.reference_confidence, NEW.reference_matched_by, NEW.reference_match_method,
         NEW.reference_source_provider, NEW.reference_source_snapshot_id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.patient_medication_reference_matches (
    medication_order_id, owner_type, owner_id, reference_status, candidate_concepts,
    medication_concept_id, confidence, matched_by, match_method, source_provider, reference_snapshot_id
  ) VALUES (
    NEW.id, NEW.owner_type, NEW.owner_id, NEW.reference_status, NEW.reference_candidate_concepts,
    NEW.medication_concept_id, NEW.reference_confidence, NEW.reference_matched_by,
    NEW.reference_match_method, NEW.reference_source_provider, NEW.reference_source_snapshot_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_patient_medication_reference_match_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_provider text;
  v_document_status text;
  v_test_only boolean;
BEGIN
  IF NEW.reference_status = 'matched' AND EXISTS (
    SELECT 1 FROM public.medication_concepts
    WHERE id = NEW.medication_concept_id AND test_only
  ) THEN
    RAISE EXCEPTION 'Test-only medication concepts cannot be matched to patient orders' USING ERRCODE = '23514';
  END IF;
  IF NEW.reference_status <> 'verified' THEN RETURN NEW; END IF;
  SELECT d.source_provider, d.verification_status, (d.test_only OR s.test_only OR c.test_only)
    INTO v_provider, v_document_status, v_test_only
  FROM public.medication_reference_snapshots s
  JOIN public.medication_reference_documents d ON d.id = s.source_document_id
  JOIN public.medication_concepts c ON c.id = s.medication_concept_id
  WHERE s.id = NEW.reference_snapshot_id
    AND s.medication_concept_id = NEW.medication_concept_id;
  IF NOT FOUND OR v_document_status <> 'verified' OR v_test_only
     OR v_provider IS DISTINCT FROM NEW.source_provider THEN
    RAISE EXCEPTION 'Verified match event requires a verified non-test source snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_patient_medication_reference_summary_for_ai()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_document_status text;
  v_test_only boolean;
BEGIN
  SELECT d.verification_status, (d.test_only OR s.test_only OR NEW.test_only)
    INTO v_document_status, v_test_only
  FROM public.medication_reference_snapshots s
  JOIN public.medication_reference_documents d ON d.id = s.source_document_id
  WHERE s.id = NEW.reference_snapshot_id;
  IF NOT FOUND OR NEW.review_status <> 'reviewed' OR v_document_status <> 'verified' OR v_test_only THEN
    RAISE EXCEPTION 'Only reviewed summaries of verified non-test sources may be used' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER medication_reference_snapshots_validate
  BEFORE INSERT ON public.medication_reference_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.validate_medication_reference_snapshot();
CREATE TRIGGER medication_reference_documents_append_only
  BEFORE UPDATE OR DELETE ON public.medication_reference_documents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_patient_medication_audit_mutation();
CREATE TRIGGER medication_reference_snapshots_append_only
  BEFORE UPDATE OR DELETE ON public.medication_reference_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.prevent_patient_medication_audit_mutation();
CREATE TRIGGER medication_reference_summaries_validate
  BEFORE INSERT ON public.medication_reference_summaries
  FOR EACH ROW EXECUTE FUNCTION public.validate_medication_reference_summary();
CREATE TRIGGER medication_reference_summaries_append_only
  BEFORE UPDATE OR DELETE ON public.medication_reference_summaries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_patient_medication_audit_mutation();
CREATE TRIGGER medication_reference_summaries_reviewed_only_insert
  BEFORE INSERT ON public.medication_reference_summaries
  FOR EACH ROW WHEN (NEW.review_status = 'reviewed')
  EXECUTE FUNCTION public.validate_patient_medication_reference_summary_for_ai();
CREATE TRIGGER patient_medication_orders_verified_reference_validate
  BEFORE INSERT OR UPDATE ON public.patient_medication_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_patient_medication_verified_reference();
CREATE TRIGGER patient_medication_orders_reference_match_audit
  AFTER INSERT OR UPDATE ON public.patient_medication_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_patient_medication_reference_match();
CREATE TRIGGER patient_medication_reference_matches_append_only
  BEFORE UPDATE OR DELETE ON public.patient_medication_reference_matches
  FOR EACH ROW EXECUTE FUNCTION public.prevent_patient_medication_audit_mutation();
CREATE TRIGGER patient_medication_reference_matches_verified_validate
  BEFORE INSERT ON public.patient_medication_reference_matches
  FOR EACH ROW EXECUTE FUNCTION public.validate_patient_medication_reference_match_event();
CREATE TRIGGER medication_orders_reject_test_only_concept
  BEFORE INSERT OR UPDATE OF medication_concept_id ON public.medication_orders
  FOR EACH ROW EXECUTE FUNCTION public.reject_test_only_clinician_medication_concept();
CREATE TRIGGER medication_concepts_test_only_immutable
  BEFORE UPDATE OF test_only ON public.medication_concepts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_medication_concept_test_only_mutation();

ALTER TABLE public.medication_reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_reference_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_reference_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_medication_reference_matches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.medication_reference_documents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.medication_reference_snapshots FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.medication_reference_summaries FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.patient_medication_reference_matches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.medication_reference_documents TO service_role;
GRANT SELECT, INSERT ON TABLE public.medication_reference_snapshots TO service_role;
GRANT SELECT, INSERT ON TABLE public.medication_reference_summaries TO service_role;
GRANT SELECT, INSERT ON TABLE public.patient_medication_reference_matches TO service_role;

REVOKE ALL ON FUNCTION public.validate_medication_reference_snapshot() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_medication_reference_summary() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_patient_medication_verified_reference() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.audit_patient_medication_reference_match() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_patient_medication_reference_match_event() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_patient_medication_reference_summary_for_ai() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_test_only_clinician_medication_concept() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_medication_concept_test_only_mutation() FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
