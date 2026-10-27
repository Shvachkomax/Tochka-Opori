-- Clinical Outbox PostgreSQL 17 integration lab (Clinical-Test ONLY).
-- Never run this script against public medical tables or production.
-- Uses exact table/function definitions from staged 056; replaces ONLY the
-- production-table trigger attachment with synthetic fixtures.
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

-- Dedicated synthetic tables: only in the separate Clinical-Test project.
CREATE SCHEMA IF NOT EXISTS clinical_outbox_lab;
REVOKE ALL ON SCHEMA clinical_outbox_lab FROM PUBLIC, anon, authenticated;

CREATE TABLE clinical_outbox_lab.synthetic_support (
 id text PRIMARY KEY, owner_type text NOT NULL,
 owner_id text NOT NULL, organization_id text,
 scenario text NOT NULL,
 revision integer NOT NULL DEFAULT 1
);
CREATE TABLE clinical_outbox_lab.synthetic_health (
 id text PRIMARY KEY, owner_type text NOT NULL,
 owner_id text NOT NULL, organization_id text,
 scenario text NOT NULL, revision integer NOT NULL DEFAULT 1
);
ALTER TABLE clinical_outbox_lab.synthetic_support ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_outbox_lab.synthetic_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clinical_outbox_lab.synthetic_support FROM PUBLIC,anon,authenticated;
REVOKE ALL ON clinical_outbox_lab.synthetic_health FROM PUBLIC,anon,authenticated;

CREATE TRIGGER clinical_outbox_audit AFTER INSERT OR UPDATE OR DELETE
 ON clinical_outbox_lab.synthetic_support
 FOR EACH ROW EXECUTE FUNCTION clinical_internal.capture_source_change();
CREATE TRIGGER clinical_outbox_audit AFTER INSERT OR UPDATE OR DELETE
 ON clinical_outbox_lab.synthetic_health
 FOR EACH ROW EXECUTE FUNCTION clinical_internal.capture_source_change();

COMMENT ON SCHEMA clinical_outbox_lab IS
 'Disposable isolated integration laboratory; only synthetic medical events.';
COMMIT;
