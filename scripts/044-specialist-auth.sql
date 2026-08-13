-- Specialist Auth — Phase 1B (corrected)
-- Dedicated session tokens for /specialist cabinet.
-- Additive, idempotent. No destructive data changes.

-- ============================================================================
-- 1. specialist_sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS specialist_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id     uuid NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Lookup by expert (session list, cleanup jobs)
CREATE INDEX IF NOT EXISTS ss_expert_id_idx
  ON specialist_sessions (expert_id);

-- Cleanup job index: find expired sessions for pruning
CREATE INDEX IF NOT EXISTS ss_expires_at_idx
  ON specialist_sessions (expires_at);

-- NOTE: token_hash already has a UNIQUE constraint from the table definition.
-- Authentication lookup: SELECT ... WHERE token_hash = $1
-- Application-layer checks: revoked_at IS NULL AND expires_at > now().
-- No time-dependent index predicates.

-- ============================================================================
-- 2. RLS — service-role only, no client access
-- ============================================================================

ALTER TABLE specialist_sessions ENABLE ROW LEVEL SECURITY;

-- Revoke direct client table access (anon/authenticated cannot reach this table)
REVOKE ALL ON TABLE specialist_sessions FROM anon;
REVOKE ALL ON TABLE specialist_sessions FROM authenticated;

-- No policies created for anon or authenticated.
-- Service-role bypasses RLS by default — no policy needed for backend access.
