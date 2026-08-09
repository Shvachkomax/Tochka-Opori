-- Migration 041: Support AI quick chat
-- Owner-level chat messages for quick conversations in Support cabinet.

CREATE TABLE IF NOT EXISTS support_ai_chat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  role text NOT NULL,
  message_text text NOT NULL,
  ai_response jsonb,
  context_snapshot jsonb,
  source_session_id text,
  request_id text,
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ai_chat_role_check CHECK (role IN ('user', 'assistant', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_support_ai_chat_owner
  ON support_ai_chat (owner_id, created_at DESC);

ALTER TABLE support_ai_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_ai_chat_service_role_only"
  ON support_ai_chat
  USING (current_setting('role') = 'service_role');

NOTIFY pgrst, 'reload schema';
