-- C2 v0.1 hardening: enforce local invariants not dependent on phase ordering.

ALTER TABLE public.medication_order_schedules
  ADD CONSTRAINT medication_order_schedules_phase_range_check
  CHECK (phase_end_at IS NULL OR phase_end_at > phase_start_at);

ALTER TABLE public.medication_order_schedules
  ADD CONSTRAINT medication_order_schedules_timezone_check
  CHECK (length(trim(timezone)) > 0);

ALTER TABLE public.medication_order_schedules
  ADD CONSTRAINT medication_order_schedules_max_dose_unit_check
  CHECK (
    max_daily_dose_unit IS NULL
    OR max_daily_dose_unit IN ('mg', 'g', 'mcg', 'ml', 'unit', '%')
  );

ALTER TABLE public.medication_ai_permissions
  ADD CONSTRAINT medication_ai_permissions_actor_check
  CHECK (granted_by_expert_id IS NOT NULL);
