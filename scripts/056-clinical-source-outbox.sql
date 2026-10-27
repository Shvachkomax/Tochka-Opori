-- Clinical Longitudinal Registry: transactionally captured source changes.
-- DRAFT MIGRATION: do not apply to production until schema/rights/retention audit.
-- Captures minimal references, never notes, diagnosis, drug instructions, speech or images.
BEGIN;

CREATE TABLE IF NOT EXISTS public.clinical_source_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL,
  source_key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  owner_type text,
  owner_id uuid,
  organization_id uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','processed','retry','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  next_attempt_at timestamptz,
  leased_until timestamptz,
  processed_at timestamptz,
  last_error_code text
);
CREATE INDEX IF NOT EXISTS clinical_source_outbox_pending
  ON public.clinical_source_outbox(status,next_attempt_at,id)
  WHERE status IN ('pending','retry');
CREATE INDEX IF NOT EXISTS clinical_source_outbox_owner
  ON public.clinical_source_outbox(owner_type,owner_id,id);
ALTER TABLE public.clinical_source_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinical_source_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.clinical_source_outbox TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.clinical_source_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.clinical_outbox_capture_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v jsonb;
  v_owner_text text;
  v_org_text text;
  v_id text;
  v_owner uuid;
  v_org uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v := to_jsonb(OLD); ELSE v := to_jsonb(NEW); END IF;
  -- Every audited row requires a stable primary reference. Fail the originating
  -- transaction (rather than silently losing the event) if it is absent.
  v_id := COALESCE(NULLIF(v->>'id',''), NULLIF(v->>'session_id',''));
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'clinical_outbox_missing_source_key (%).%', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE='23514';
  END IF;
  v_owner_text := COALESCE(NULLIF(v->>'owner_id',''), NULLIF(v->>'anonymous_owner_id',''));
  v_org_text := NULLIF(v->>'organization_id','');
  IF v_owner_text IS NOT NULL THEN v_owner := v_owner_text::uuid; END IF;
  IF v_org_text IS NOT NULL THEN v_org := v_org_text::uuid; END IF;
  INSERT INTO public.clinical_source_outbox (
    source_table,source_key,operation,owner_type,owner_id,organization_id
  ) VALUES (
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_id, TG_OP,
    v->>'owner_type',v_owner,v_org
  );
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.clinical_outbox_capture_trigger() FROM PUBLIC, anon, authenticated;

-- Strict declaration of monitored source tables. Migrations must be audited against
-- the real main DB schema first; missing sources are an error, not a silent omission.
DO $$
DECLARE
  table_name text;
  names text[] := ARRAY[
    'sessions',
    'service_requests',
    'medication_orders',
    'medication_order_lifecycle_events',
    'clinician_decisions',
    'clinical_outcomes',
    'clinical_observations',
    'patient_medication_orders',
    'patient_medication_order_events',
    'medication_intake_logs',
    'body_daily_logs',
    'support_daily_checkins'
  ];
  missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH table_name IN ARRAY names LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      missing := array_append(missing,table_name);
    END IF;
  END LOOP;
  IF cardinality(missing)>0 THEN
    RAISE EXCEPTION 'Clinical outbox source schema unverified: %', array_to_string(missing, ', ');
  END IF;
  FOREACH table_name IN ARRAY names LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS clinical_outbox_audit ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER clinical_outbox_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.clinical_outbox_capture_trigger()',table_name);
  END LOOP;
END;
$$;

COMMENT ON TABLE public.clinical_source_outbox IS
 'Sensitive patient-linked operational integrity data. Not a research cohort or public library.';
COMMIT;
