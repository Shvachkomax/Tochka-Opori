-- Patient-reported physician medication/supplement orders and actual intake.
-- This is separate from immutable clinician-authored C2 medication_orders.

CREATE TABLE IF NOT EXISTS public.patient_medication_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  session_id text,
  source_module text NOT NULL CHECK (source_module IN ('health', 'support')),
  item_type text NOT NULL CHECK (item_type IN ('medication', 'supplement')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  active_ingredient text,
  dosage_form text,
  strength text,
  single_dose numeric NOT NULL CHECK (single_dose > 0),
  dose_unit text NOT NULL CHECK (length(btrim(dose_unit)) BETWEEN 1 AND 40),
  route text,
  frequency_type text NOT NULL CHECK (frequency_type IN ('times_per_day', 'scheduled_times', 'as_needed', 'text')),
  times_per_day integer CHECK (times_per_day BETWEEN 1 AND 24),
  scheduled_times jsonb,
  instructions text,
  start_date date NOT NULL,
  end_date date,
  ongoing boolean NOT NULL DEFAULT false,
  doctor_comment text,
  patient_comment text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  reported_as_doctor_order boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_medication_orders_id_owner_unique UNIQUE (id, owner_type, owner_id),
  CONSTRAINT patient_medication_orders_owner_type_check
    CHECK ((source_module = 'health' AND owner_type = 'anonymous_profile') OR (source_module = 'support' AND owner_type = 'anonymous_case')),
  CONSTRAINT patient_medication_orders_dates_check
    CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT patient_medication_orders_frequency_check
    CHECK (
      (frequency_type = 'times_per_day' AND times_per_day IS NOT NULL)
      OR (frequency_type = 'scheduled_times' AND CASE
        WHEN jsonb_typeof(scheduled_times) = 'array' THEN jsonb_array_length(scheduled_times) BETWEEN 1 AND 24
        ELSE false
      END)
      OR (frequency_type IN ('as_needed', 'text'))
    )
);

CREATE INDEX IF NOT EXISTS patient_medication_orders_owner_idx
  ON public.patient_medication_orders (owner_type, owner_id, source_module, status, start_date);
CREATE INDEX IF NOT EXISTS patient_medication_orders_schedule_idx
  ON public.patient_medication_orders (status, start_date, end_date)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.medication_intake_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  medication_order_id uuid NOT NULL,
  scheduled_date date NOT NULL,
  scheduled_time time,
  scheduled_slot integer NOT NULL CHECK (scheduled_slot BETWEEN 1 AND 24),
  status text NOT NULL CHECK (status IN ('taken', 'missed', 'taken_late', 'different_dose')),
  actual_time time,
  actual_dose numeric CHECK (actual_dose IS NULL OR actual_dose > 0),
  actual_dose_unit text,
  patient_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_intake_logs_owner_order_unique UNIQUE (medication_order_id, scheduled_date, scheduled_slot),
  CONSTRAINT medication_intake_logs_order_owner_fk
    FOREIGN KEY (medication_order_id, owner_type, owner_id)
    REFERENCES public.patient_medication_orders (id, owner_type, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS medication_intake_logs_owner_date_idx
  ON public.medication_intake_logs (owner_type, owner_id, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS medication_intake_logs_order_date_idx
  ON public.medication_intake_logs (medication_order_id, scheduled_date DESC);

CREATE TABLE IF NOT EXISTS public.patient_medication_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  medication_order_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'status_changed')),
  changed_fields text[] NOT NULL DEFAULT '{}',
  previous_status text,
  new_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_medication_order_events_order_owner_fk
    FOREIGN KEY (medication_order_id, owner_type, owner_id)
    REFERENCES public.patient_medication_orders (id, owner_type, owner_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS patient_medication_order_events_owner_idx
  ON public.patient_medication_order_events (owner_type, owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS patient_medication_order_events_order_idx
  ON public.patient_medication_order_events (medication_order_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_patient_medication_order_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_changed_fields text[] := '{}';
  v_event_type text := 'created';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(field_name ORDER BY field_name), '{}')
      INTO v_changed_fields
    FROM unnest(ARRAY[
      'item_type', 'name', 'active_ingredient', 'dosage_form', 'strength', 'single_dose', 'dose_unit',
      'route', 'frequency_type', 'times_per_day', 'scheduled_times', 'instructions', 'start_date',
      'end_date', 'ongoing', 'doctor_comment', 'patient_comment', 'status'
    ]) AS fields(field_name)
    WHERE (to_jsonb(NEW) -> field_name) IS DISTINCT FROM (to_jsonb(OLD) -> field_name);

    IF cardinality(v_changed_fields) = 0 THEN RETURN NEW; END IF;
    v_event_type := CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'status_changed' ELSE 'updated' END;
  END IF;

  INSERT INTO public.patient_medication_order_events (
    owner_type, owner_id, medication_order_id, event_type, changed_fields, previous_status, new_status
  ) VALUES (
    NEW.owner_type, NEW.owner_id, NEW.id, v_event_type, v_changed_fields,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END, NEW.status
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patient_medication_orders_audit ON public.patient_medication_orders;
CREATE TRIGGER patient_medication_orders_audit
  AFTER INSERT OR UPDATE ON public.patient_medication_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_patient_medication_order_change();

CREATE OR REPLACE FUNCTION public.prevent_patient_medication_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'patient medication audit records are append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS patient_medication_order_events_append_only ON public.patient_medication_order_events;
CREATE TRIGGER patient_medication_order_events_append_only
  BEFORE UPDATE OR DELETE ON public.patient_medication_order_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_patient_medication_audit_mutation();

ALTER TABLE public.patient_medication_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_intake_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_medication_order_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.patient_medication_orders FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.medication_intake_logs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.patient_medication_order_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.patient_medication_orders TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.medication_intake_logs TO service_role;
GRANT SELECT, INSERT ON TABLE public.patient_medication_order_events TO service_role;
REVOKE ALL ON FUNCTION public.prevent_patient_medication_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.audit_patient_medication_order_change() FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
