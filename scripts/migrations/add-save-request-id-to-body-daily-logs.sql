-- Migration: add save_request_id to body_daily_logs for save verification.
-- This enables checking whether a specific diary save operation succeeded
-- after a lost network response.

ALTER TABLE body_daily_logs
  ADD COLUMN IF NOT EXISTS save_request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_body_daily_logs_save_request_id
  ON body_daily_logs (save_request_id)
  WHERE save_request_id IS NOT NULL;

-- Optional: unique constraint to prevent duplicate saves for same operation
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_body_daily_logs_save_request_unique
--   ON body_daily_logs (save_request_id)
--   WHERE save_request_id IS NOT NULL;
