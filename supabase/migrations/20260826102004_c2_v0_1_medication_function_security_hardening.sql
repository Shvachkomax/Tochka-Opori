-- C2 v0.1 security hardening: pin search_path for all C2 functions.

ALTER FUNCTION public.prevent_medication_history_mutation()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.validate_medication_schedule(timestamptz, timestamptz, text, jsonb)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.assert_medication_prescriber(text, uuid, uuid, uuid, uuid)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.activate_medication_order(
  text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text,
  timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid
)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.supersede_medication_order(
  uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text,
  timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid
)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.revoke_medication_order(
  uuid, text, uuid, uuid, uuid, text, text, text, uuid
)
  SET search_path = pg_catalog, public;
