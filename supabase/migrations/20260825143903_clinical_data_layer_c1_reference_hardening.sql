-- Phase C1 remediation: preserve audit references to operational entities.

ALTER TABLE public.clinical_events
  ADD CONSTRAINT clinical_events_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON DELETE RESTRICT;

ALTER TABLE public.clinical_observations
  ADD CONSTRAINT clinical_observations_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON DELETE RESTRICT;

ALTER TABLE public.clinician_decisions
  ADD CONSTRAINT clinician_decisions_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON DELETE RESTRICT;

ALTER TABLE public.clinical_outcomes
  ADD CONSTRAINT clinical_outcomes_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON DELETE RESTRICT;

ALTER TABLE public.clinical_events
  ADD CONSTRAINT clinical_events_expert_id_fkey
  FOREIGN KEY (expert_id)
  REFERENCES public.experts(id)
  ON DELETE RESTRICT;

ALTER TABLE public.clinician_decisions
  ADD CONSTRAINT clinician_decisions_expert_id_fkey
  FOREIGN KEY (expert_id)
  REFERENCES public.experts(id)
  ON DELETE RESTRICT;

ALTER TABLE public.clinician_decisions
  ADD CONSTRAINT clinician_decisions_related_service_request_id_fkey
  FOREIGN KEY (related_service_request_id)
  REFERENCES public.service_requests(id)
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT clinical_events_organization_id_fkey ON public.clinical_events IS
  'Retain organization attribution for clinical audit history.';
COMMENT ON CONSTRAINT clinical_events_expert_id_fkey ON public.clinical_events IS
  'Retain expert attribution for clinical audit history.';
