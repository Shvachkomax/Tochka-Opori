-- C2 v0.1 schedule completeness is checked after all phases are inserted.

CREATE OR REPLACE FUNCTION public.validate_medication_order_schedule_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_row record;
  phase_count integer;
  open_phase_count integer;
  first_phase integer;
  last_phase integer;
  first_start timestamptz;
  last_end timestamptz;
BEGIN
  SELECT valid_from, valid_until INTO order_row
  FROM public.medication_orders
  WHERE id = NEW.medication_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medication order for schedule was not found' USING ERRCODE = '23503';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE phase_end_at IS NULL), min(phase_number), max(phase_number),
    min(phase_start_at), max(phase_end_at)
  INTO phase_count, open_phase_count, first_phase, last_phase, first_start, last_end
  FROM public.medication_order_schedules
  WHERE medication_order_id = NEW.medication_order_id;

  IF phase_count = 0 OR first_phase <> 1 OR last_phase <> phase_count THEN
    RAISE EXCEPTION 'Medication schedule phases must be sequential' USING ERRCODE = '22023';
  END IF;
  IF first_start <> order_row.valid_from THEN
    RAISE EXCEPTION 'Medication schedule must start at order valid_from' USING ERRCODE = '22023';
  END IF;
  IF open_phase_count > 1 OR EXISTS (
    SELECT 1 FROM public.medication_order_schedules
    WHERE medication_order_id = NEW.medication_order_id
      AND phase_end_at IS NULL
      AND phase_number <> last_phase
  ) THEN
    RAISE EXCEPTION 'Only the final medication phase may be open-ended' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.medication_order_schedules first_phase_row
    JOIN public.medication_order_schedules next_phase_row
      ON next_phase_row.medication_order_id = first_phase_row.medication_order_id
     AND next_phase_row.phase_number = first_phase_row.phase_number + 1
    WHERE first_phase_row.medication_order_id = NEW.medication_order_id
      AND first_phase_row.phase_end_at IS DISTINCT FROM next_phase_row.phase_start_at
  ) THEN
    RAISE EXCEPTION 'Medication schedule phases must have no gaps or overlaps' USING ERRCODE = '22023';
  END IF;
  IF order_row.valid_until IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.medication_order_schedules
      WHERE medication_order_id = NEW.medication_order_id
        AND phase_start_at >= order_row.valid_until
    ) THEN
      RAISE EXCEPTION 'Medication phase starts at or after order validity end' USING ERRCODE = '22023';
    END IF;
    IF last_end IS NOT NULL AND last_end < order_row.valid_until THEN
      RAISE EXCEPTION 'Finite medication schedule does not cover order validity' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medication_order_schedule_completeness ON public.medication_order_schedules;
CREATE CONSTRAINT TRIGGER medication_order_schedule_completeness
  AFTER INSERT ON public.medication_order_schedules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_medication_order_schedule_complete();

ALTER FUNCTION public.validate_medication_order_schedule_complete()
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.validate_medication_order_schedule_complete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_medication_order_schedule_complete() TO service_role;
