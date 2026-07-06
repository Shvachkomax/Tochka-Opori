-- Add conversation_pairs column to sessions table for structured pairs storage
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS conversation_pairs JSONB DEFAULT '[]'::jsonb;
