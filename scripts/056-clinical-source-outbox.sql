-- CLINICAL LONGITUDINAL v0.2 - STAGED / NOT APPROVED FOR PRODUCTION.
-- Preflight the actual EHR schema; deploy only after backup, permissions and load review.
-- Append-only transactional change notifications. No clinical payload or transcripts.
BEGIN;

CREATE SCHEMA IF NOT EXISTS clinical_internal;
REVOKE ALL ON SCHEMA clinical_internal FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS clinical_internal.source_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_table text NOT NULL,
 source_key text NOT NULL,
 operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
 -- Key references are sensitive even without names; use only in restricted DB.
 owner_type text,
 owner_key text,
 organization_key text,
 captured_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending'
   CHECK (status IN ('pending','processing','retry','processed','dead_letter')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 available_at timestamptz,
 lease_token uuid,
 leased_until timestamptz,
 processed_at timestamptz,
 error_code text
);
CREATE INDEX IF NOT EXISTS source_outbox_work_idx ON clinical_internal.source_outbox
 (status,available_at,id) WHERE status IN ('pending','retry','processing');

CREATE TABLE IF NOT EXISTS clinical_internal.source_receipts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 outbox_id bigint NOT NULL UNIQUE REFERENCES clinical_internal.source_outbox(id),
 source_table text NOT NULL,
 source_key text NOT NULL,
 operation text NOT NULL,
 owner_type text,
 owner_key text,
 organization_key text,
 captured_at timestamptz NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_receipts_source_idx
 ON clinical_internal.source_receipts(source_table,source_key,outbox_id);

ALTER TABLE clinical_internal.source_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_internal.source_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clinical_internal.source_outbox FROM PUBLIC,anon,authenticated;
REVOKE ALL ON clinical_internal.source_receipts FROM PUBLIC,anon,authenticated;
-- Provision a dedicated restricted Postgres worker role separately after DB review.
-- Do not grant either table to the web/anon/authenticated/REST roles.

CREATE OR REPLACE FUNCTION clinical_internal.capture_source_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $body$
DECLARE
 v jsonb;
 v_source_key text;
BEGIN
 IF TG_OP = 'DELETE' THEN v := to_jsonb(OLD); ELSE v := to_jsonb(NEW); END IF;
 v_source_key := COALESCE(NULLIF(v->>'id',''),NULLIF(v->>'session_id',''));
 IF v_source_key IS NULL THEN
   RAISE EXCEPTION 'clinical_outbox_source_key_missing'
     USING ERRCODE='23514';
 END IF;
 INSERT INTO clinical_internal.source_outbox
  (source_table,source_key,operation,owner_type,owner_key,organization_key)
 VALUES
  (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,v_source_key,TG_OP,
   v->>'owner_type',
   COALESCE(NULLIF(v->>'owner_id',''),NULLIF(v->>'anonymous_owner_id','')),
   NULLIF(v->>'organization_id',''));
 -- This insert is in the SAME database transaction as the clinical source write:
 -- a rejected outbox insert aborts the source write rather than hiding loss.
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$body$;
REVOKE ALL ON FUNCTION clinical_internal.capture_source_change() FROM PUBLIC,anon,authenticated;

DO $validate$
DECLARE
 t text;
 src text[] := ARRAY[
  'sessions','service_requests','medication_orders',
  'medication_order_lifecycle_events','clinician_decisions','clinical_outcomes',
  'clinical_observations','patient_medication_orders','patient_medication_order_events',
  'medication_intake_logs','body_daily_logs','support_daily_checkins'
 ];
BEGIN
 FOREACH t IN ARRAY src LOOP
   IF to_regclass(format('public.%I',t)) IS NULL THEN
     RAISE EXCEPTION 'clinical outbox: required source missing (%)',t;
   END IF;
   IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema='public' AND c.table_name=t
       AND c.column_name IN ('id','session_id')) THEN
     RAISE EXCEPTION 'clinical outbox: source without stable reference (%)',t;
   END IF;
 END LOOP;
 FOREACH t IN ARRAY src LOOP
   -- Drop/recreate only our own trigger, never unrelated triggers.
   EXECUTE format('DROP TRIGGER IF EXISTS clinical_outbox_audit ON public.%I',t);
   EXECUTE format(
     'CREATE TRIGGER clinical_outbox_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION clinical_internal.capture_source_change()',t);
 END LOOP;
END;
$validate$;
COMMENT ON SCHEMA clinical_internal IS
 'Private operations, never exposed to PostgREST; medical source references remain sensitive.';
COMMENT ON TABLE clinical_internal.source_receipts IS
 'Immutable receipts for source changes. Not medical snapshots, research data or claims of clinical outcome.';
COMMIT;
