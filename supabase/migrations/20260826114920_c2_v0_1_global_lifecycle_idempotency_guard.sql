-- C2 v0.1: an idempotency key identifies one lifecycle command globally.

CREATE UNIQUE INDEX medication_order_lifecycle_global_idempotency_idx
  ON public.medication_order_lifecycle_events (idempotency_key);
