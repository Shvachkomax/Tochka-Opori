-- Phase C1.1.1: ownership-safe observation identity and supersession.
-- Replace only the C1.1 projection identity index; no historical data changes.

DROP INDEX IF EXISTS public.clinical_observations_projection_identity_idx;

CREATE UNIQUE INDEX clinical_observations_projection_identity_idx
  ON public.clinical_observations (
    module,
    owner_type,
    owner_id,
    source_type,
    source_id,
    concept,
    source_event_key
  )
  NULLS NOT DISTINCT;
