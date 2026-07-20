-- Fix column types: intake/daily_log session codes are text (HEALTH-XXXX-XXX),
-- not uuid. Both session_id and target_id need to be text.

ALTER TABLE body_expert_reviews
  ALTER COLUMN session_id TYPE text USING session_id::text,
  ALTER COLUMN target_id TYPE text USING target_id::text;

COMMENT ON COLUMN body_expert_reviews.session_id IS
'Public session code or internal session identifier, e.g. HEALTH-XXXX-XXX or ТОЧКА-XXXX-XXXX.';

COMMENT ON COLUMN body_expert_reviews.target_id IS
'ID of the reviewed entity (intake session code, daily log uuid, etc.).';
