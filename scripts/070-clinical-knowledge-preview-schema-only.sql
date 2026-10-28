-- Clinical Knowledge consolidation v0.6 → existing Preview-Test.
-- Additive SCHEMA-ONLY migration. No clinical content, patient data, credentials,
-- reviewer assignments, production grants, published approvals or finance changes.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('public.clinical_knowledge_cases') IS NULL
    OR to_regclass('public.clinical_knowledge_query_log') IS NULL
    OR to_regclass('public.experts') IS NULL
    OR to_regclass('public.expert_organization_memberships') IS NULL THEN
  RAISE EXCEPTION 'Not the shared Support/Health Preview-Test schema';
 END IF;
 IF to_regclass('public.published_clinical_cases') IS NOT NULL
    OR to_regclass('public.clinical_review_log') IS NOT NULL THEN
  RAISE EXCEPTION 'Clinical Knowledge published/review schema already exists: review before applying';
 END IF;
END;
$preflight$;

CREATE TABLE public.published_clinical_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL,
 authors text,
 journal text,
 year integer,
 doi text,
 source_url text NOT NULL,
 specialty text,
 symptoms text[] NOT NULL DEFAULT '{}',
 diagnosis text,
 examinations text[] NOT NULL DEFAULT '{}',
 treatment text,
 outcomes text,
 applicability_limits text,
 usage_rights text,
 expert_review_status text NOT NULL DEFAULT 'draft'
  CHECK (expert_review_status IN ('draft','pending_review','approved','rejected','archived')),
 last_verified_at date,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 submitted_by_expert_id uuid REFERENCES public.experts(id) ON DELETE RESTRICT,
 version text NOT NULL DEFAULT '1',
 source_verified boolean NOT NULL DEFAULT false,
 rights_verified boolean NOT NULL DEFAULT false,
 medications jsonb NOT NULL DEFAULT '[]'::jsonb,
 modules text[] NOT NULL DEFAULT '{}',
 clinical_tags text[] NOT NULL DEFAULT '{}',
 CONSTRAINT ck_published_only_verified_approvable
  CHECK (expert_review_status <> 'approved' OR (source_verified AND rights_verified)),
 CONSTRAINT ck_published_valid_modules
  CHECK (modules <@ ARRAY['support','health']::text[])
);
CREATE INDEX ck_published_review_queue_idx
 ON public.published_clinical_cases(expert_review_status,updated_at DESC);
CREATE INDEX ck_published_modules_idx ON public.published_clinical_cases USING GIN(modules);
CREATE INDEX ck_published_tags_idx ON public.published_clinical_cases USING GIN(clinical_tags);
CREATE UNIQUE INDEX ck_published_doi_unique_idx
 ON public.published_clinical_cases(lower(btrim(doi)))
 WHERE doi IS NOT NULL AND btrim(doi)<>'';

CREATE TABLE public.clinical_review_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reviewer_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE RESTRICT,
 publication_id text NOT NULL,
 publication_version text,
 decision text NOT NULL CHECK (decision IN ('approve','request_changes','reject')),
 comment text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text,
 CONSTRAINT ck_review_unique_decision UNIQUE(reviewer_id,publication_id,publication_version,decision)
);
CREATE UNIQUE INDEX ck_review_idempotency_idx
 ON public.clinical_review_log(publication_id,idempotency_key)
 WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.published_clinical_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_review_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.published_clinical_cases,public.clinical_review_log FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.published_clinical_cases TO service_role;
GRANT SELECT,INSERT ON public.clinical_review_log TO service_role;
CREATE POLICY ck_published_service_only ON public.published_clinical_cases
 FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY ck_review_service_read ON public.clinical_review_log
 FOR SELECT TO service_role USING(true);
CREATE POLICY ck_review_service_write ON public.clinical_review_log
 FOR INSERT TO service_role WITH CHECK(true);

CREATE FUNCTION public.ck_prevent_review_log_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $function$
BEGIN
 RAISE EXCEPTION 'clinical_review_log is append-only';
END;
$function$;
REVOKE ALL ON FUNCTION public.ck_prevent_review_log_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ck_review_no_update
 BEFORE UPDATE ON public.clinical_review_log
 FOR EACH ROW EXECUTE FUNCTION public.ck_prevent_review_log_mutation();
CREATE TRIGGER ck_review_no_delete
 BEFORE DELETE ON public.clinical_review_log
 FOR EACH ROW EXECUTE FUNCTION public.ck_prevent_review_log_mutation();
CREATE TRIGGER ck_review_no_truncate
 BEFORE TRUNCATE ON public.clinical_review_log
 FOR EACH STATEMENT EXECUTE FUNCTION public.ck_prevent_review_log_mutation();

COMMENT ON TABLE public.published_clinical_cases IS
 'Clinical Knowledge bibliographic cases; no automatic approval. All imported records require evidence and rights review.';
COMMENT ON TABLE public.clinical_review_log IS
 'Append-only reviewer decisions. No patient clinical notes or raw session transcripts.';
COMMIT;
