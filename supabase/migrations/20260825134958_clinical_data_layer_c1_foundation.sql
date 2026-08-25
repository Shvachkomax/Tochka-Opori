-- Phase C1: foundational longitudinal clinical data layer.
-- Additive only: existing operational tables remain canonical.

CREATE TABLE public.clinical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  organization_id uuid,
  expert_id uuid,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_type text NOT NULL,
  source_id text,
  source_event_key text NOT NULL,
  provenance text NOT NULL,
  confidence numeric,
  validation_status text NOT NULL DEFAULT 'unreviewed',
  quality_level integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_events_owner_scope_check CHECK (
    (module = 'support' AND owner_type = 'anonymous_case')
    OR (module = 'body' AND owner_type = 'anonymous_profile')
  ),
  CONSTRAINT clinical_events_provenance_check CHECK (
    provenance IN (
      'patient_reported', 'clinician_entered', 'clinician_ordered',
      'device_measured', 'lab_result', 'ai_extracted', 'ai_inferred',
      'clinician_confirmed', 'system_generated'
    )
  ),
  CONSTRAINT clinical_events_validation_status_check CHECK (
    validation_status IN ('unreviewed', 'ai_structured', 'clinician_reviewed', 'clinician_confirmed', 'rejected')
  ),
  CONSTRAINT clinical_events_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT clinical_events_quality_level_check CHECK (quality_level IS NULL OR (quality_level >= 0 AND quality_level <= 5)),
  CONSTRAINT clinical_events_payload_object_check CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE public.clinical_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinical_event_id uuid REFERENCES public.clinical_events(id) ON DELETE RESTRICT,
  module text NOT NULL,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  organization_id uuid,
  concept text NOT NULL,
  value_numeric numeric,
  value_text text,
  value_boolean boolean,
  unit text,
  severity text,
  observed_at timestamptz NOT NULL,
  source_type text NOT NULL,
  source_id text,
  provenance text NOT NULL,
  confidence numeric,
  validation_status text NOT NULL DEFAULT 'unreviewed',
  quality_level integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_observations_owner_scope_check CHECK (
    (module = 'support' AND owner_type = 'anonymous_case')
    OR (module = 'body' AND owner_type = 'anonymous_profile')
  ),
  CONSTRAINT clinical_observations_one_value_check CHECK (
    num_nonnulls(value_numeric, value_text, value_boolean) = 1
  ),
  CONSTRAINT clinical_observations_provenance_check CHECK (
    provenance IN (
      'patient_reported', 'clinician_entered', 'clinician_ordered',
      'device_measured', 'lab_result', 'ai_extracted', 'ai_inferred',
      'clinician_confirmed', 'system_generated'
    )
  ),
  CONSTRAINT clinical_observations_validation_status_check CHECK (
    validation_status IN ('unreviewed', 'ai_structured', 'clinician_reviewed', 'clinician_confirmed', 'rejected')
  ),
  CONSTRAINT clinical_observations_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT clinical_observations_quality_level_check CHECK (quality_level IS NULL OR (quality_level >= 0 AND quality_level <= 5)),
  CONSTRAINT clinical_observations_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE public.clinician_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  organization_id uuid,
  expert_id uuid NOT NULL,
  decision_type text NOT NULL,
  decision_text text NOT NULL,
  rationale text,
  related_service_request_id uuid,
  follow_up_plan text,
  follow_up_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  supersedes_decision_id uuid REFERENCES public.clinician_decisions(id) ON DELETE RESTRICT,
  quality_level integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinician_decisions_owner_scope_check CHECK (
    (module = 'support' AND owner_type = 'anonymous_case')
    OR (module = 'body' AND owner_type = 'anonymous_profile')
  ),
  CONSTRAINT clinician_decisions_type_check CHECK (
    decision_type IN (
      'continue_monitoring', 'request_clarification', 'schedule_consultation',
      'change_care_plan', 'refer_to_specialist', 'other'
    )
  ),
  CONSTRAINT clinician_decisions_status_check CHECK (status IN ('active', 'superseded', 'retracted')),
  CONSTRAINT clinician_decisions_quality_level_check CHECK (quality_level IS NULL OR (quality_level >= 0 AND quality_level <= 5)),
  CONSTRAINT clinician_decisions_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE public.clinical_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  organization_id uuid,
  decision_id uuid REFERENCES public.clinician_decisions(id) ON DELETE RESTRICT,
  assessment_event_id uuid REFERENCES public.clinical_events(id) ON DELETE RESTRICT,
  outcome_type text NOT NULL,
  baseline_value jsonb,
  followup_value jsonb,
  direction text,
  clinician_assessed boolean NOT NULL DEFAULT false,
  followup_complete boolean NOT NULL DEFAULT false,
  assessed_at timestamptz NOT NULL,
  provenance text NOT NULL,
  validation_status text NOT NULL DEFAULT 'unreviewed',
  quality_level integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_outcomes_owner_scope_check CHECK (
    (module = 'support' AND owner_type = 'anonymous_case')
    OR (module = 'body' AND owner_type = 'anonymous_profile')
  ),
  CONSTRAINT clinical_outcomes_direction_check CHECK (
    direction IS NULL OR direction IN ('improved', 'unchanged', 'worsened', 'mixed', 'unknown')
  ),
  CONSTRAINT clinical_outcomes_provenance_check CHECK (
    provenance IN (
      'patient_reported', 'clinician_entered', 'clinician_ordered',
      'device_measured', 'lab_result', 'ai_extracted', 'ai_inferred',
      'clinician_confirmed', 'system_generated'
    )
  ),
  CONSTRAINT clinical_outcomes_validation_status_check CHECK (
    validation_status IN ('unreviewed', 'ai_structured', 'clinician_reviewed', 'clinician_confirmed', 'rejected')
  ),
  CONSTRAINT clinical_outcomes_quality_level_check CHECK (quality_level IS NULL OR (quality_level >= 0 AND quality_level <= 5)),
  CONSTRAINT clinical_outcomes_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX clinical_events_projection_identity_idx
  ON public.clinical_events (source_type, source_id, event_type, source_event_key) NULLS NOT DISTINCT;

CREATE INDEX clinical_events_owner_time_idx
  ON public.clinical_events (owner_id, module, occurred_at DESC);
CREATE INDEX clinical_events_organization_time_idx
  ON public.clinical_events (organization_id, occurred_at DESC);
CREATE INDEX clinical_events_type_time_idx
  ON public.clinical_events (event_type, occurred_at DESC);
CREATE INDEX clinical_observations_owner_concept_time_idx
  ON public.clinical_observations (owner_id, concept, observed_at DESC);
CREATE INDEX clinical_observations_organization_concept_time_idx
  ON public.clinical_observations (organization_id, concept, observed_at DESC);
CREATE INDEX clinician_decisions_owner_time_idx
  ON public.clinician_decisions (owner_id, created_at DESC);
CREATE INDEX clinician_decisions_expert_time_idx
  ON public.clinician_decisions (expert_id, created_at DESC);
CREATE INDEX clinician_decisions_organization_time_idx
  ON public.clinician_decisions (organization_id, created_at DESC);
CREATE INDEX clinical_outcomes_decision_idx
  ON public.clinical_outcomes (decision_id);
CREATE INDEX clinical_outcomes_owner_time_idx
  ON public.clinical_outcomes (owner_id, assessed_at DESC);

ALTER TABLE public.clinical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinician_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_outcomes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.clinical_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.clinical_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.clinician_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.clinical_outcomes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.clinical_events TO service_role;
GRANT ALL ON TABLE public.clinical_observations TO service_role;
GRANT ALL ON TABLE public.clinician_decisions TO service_role;
GRANT ALL ON TABLE public.clinical_outcomes TO service_role;

COMMENT ON TABLE public.clinical_events IS 'Append-only longitudinal clinical timeline facts. C1 projection layer.';
COMMENT ON TABLE public.clinical_observations IS 'Structured clinical observations; provenance is never replaced.';
COMMENT ON TABLE public.clinician_decisions IS 'Explicit clinician decisions, retained across superseding changes.';
COMMENT ON TABLE public.clinical_outcomes IS 'Follow-up evidence linked to decisions or assessment events.';
COMMENT ON COLUMN public.clinical_events.source_event_key IS 'Deterministic projection identity; status transitions use one key per transition.';
COMMENT ON COLUMN public.clinical_events.quality_level IS 'Reserved L0-L5 quality scale; C1 never promotes records automatically.';
