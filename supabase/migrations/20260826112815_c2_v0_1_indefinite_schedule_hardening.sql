-- C2 v0.1: an indefinite order must have an indefinite final phase.

CREATE OR REPLACE FUNCTION public.reject_indefinite_finite_medication_schedule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_end timestamptz;
  final_end timestamptz;
BEGIN
  SELECT valid_until INTO order_end
  FROM public.medication_orders
  WHERE id = NEW.medication_order_id;
  SELECT phase_end_at INTO final_end
  FROM public.medication_order_schedules
  WHERE medication_order_id = NEW.medication_order_id
  ORDER BY phase_number DESC
  LIMIT 1;
  IF order_end IS NULL AND final_end IS NOT NULL THEN
    RAISE EXCEPTION 'Indefinite medication order requires an open-ended final phase' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medication_order_indefinite_schedule ON public.medication_order_schedules;
CREATE CONSTRAINT TRIGGER medication_order_indefinite_schedule
  AFTER INSERT ON public.medication_order_schedules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.reject_indefinite_finite_medication_schedule();

ALTER FUNCTION public.reject_indefinite_finite_medication_schedule()
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.reject_indefinite_finite_medication_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_indefinite_finite_medication_schedule() TO service_role;
