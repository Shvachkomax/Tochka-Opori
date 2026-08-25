-- Phase C1.1: immutable structured-observation revisions.
-- Existing operational rows remain mutable and are not backfilled.

ALTER TABLE public.clinical_observations
  ADD COLUMN source_event_key text;

ALTER TABLE public.clinical_observations
  ALTER COLUMN source_event_key SET NOT NULL;

ALTER TABLE public.clinical_observations
  ADD COLUMN supersedes_observation_id uuid
  REFERENCES public.clinical_observations(id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX clinical_observations_projection_identity_idx
  ON public.clinical_observations (source_type, source_id, concept, source_event_key)
  NULLS NOT DISTINCT;

CREATE INDEX clinical_observations_supersedes_idx
  ON public.clinical_observations (supersedes_observation_id);

COMMENT ON COLUMN public.clinical_observations.source_event_key IS
  'Deterministic content-derived revision identity for automated projections.';
COMMENT ON COLUMN public.clinical_observations.supersedes_observation_id IS
  'Earlier immutable observation in the same source/concept lineage.';
