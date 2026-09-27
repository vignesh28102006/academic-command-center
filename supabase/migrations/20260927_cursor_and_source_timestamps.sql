-- ==============================================================================
-- Academic Command Center Migration: 2026-09-27
-- Add source message timestamps and separate scanning cursor from event processing
-- ==============================================================================

-- 1. Extend academic_events table
ALTER TABLE academic_events
  ADD COLUMN IF NOT EXISTS source_message_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_message_date DATE;

CREATE INDEX IF NOT EXISTS idx_academic_events_source_msg_time ON academic_events(source_message_timestamp);
CREATE INDEX IF NOT EXISTS idx_academic_events_source_msg_date ON academic_events(source_message_date);

-- 2. Extend collector_group_state table
ALTER TABLE collector_group_state
  ADD COLUMN IF NOT EXISTS last_scanned_message_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_scanned_message_id TEXT,
  ADD COLUMN IF NOT EXISTS last_processed_academic_message_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_processed_academic_message_id TEXT,
  ADD COLUMN IF NOT EXISTS messages_failed INTEGER NOT NULL DEFAULT 0;

-- 3. Backfill last_scanned from existing last_processed if available
UPDATE collector_group_state
SET last_scanned_message_timestamp = last_processed_message_timestamp
WHERE last_scanned_message_timestamp IS NULL AND last_processed_message_timestamp IS NOT NULL;

UPDATE collector_group_state
SET last_scanned_message_id = last_processed_message_id
WHERE last_scanned_message_id IS NULL AND last_processed_message_id IS NOT NULL;

UPDATE collector_group_state
SET last_processed_academic_message_timestamp = last_processed_message_timestamp
WHERE last_processed_academic_message_timestamp IS NULL AND last_processed_message_timestamp IS NOT NULL;

UPDATE collector_group_state
SET last_processed_academic_message_id = last_processed_message_id
WHERE last_processed_academic_message_id IS NULL AND last_processed_message_id IS NOT NULL;
