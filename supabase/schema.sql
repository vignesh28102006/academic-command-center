-- ==============================================================================
-- Academic Command Center: PostgreSQL Schema for Supabase
-- Source of Truth for Academic Events, Change Audit Trail, Raw Ingestion & Mappings
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Academic Events Table (Core Source of Truth)
CREATE TABLE IF NOT EXISTS academic_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'INBOX',
    event_date DATE,
    event_time TEXT,
    deadline TIMESTAMPTZ,
    deadline_time TEXT,
    submission_url TEXT,
    resource_urls JSONB DEFAULT '[]'::jsonb,
    attachment_names JSONB DEFAULT '[]'::jsonb,
    description TEXT,
    requirements JSONB DEFAULT '[]'::jsonb,
    source_group TEXT,
    source_sender TEXT,
    original_messages JSONB DEFAULT '[]'::jsonb,
    source_key TEXT,
    notion_page_id TEXT,
    needs_confirmation BOOLEAN DEFAULT FALSE,
    confidence FLOAT DEFAULT 0.8,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performant filtering and lookups
CREATE INDEX IF NOT EXISTS idx_academic_events_status ON academic_events(status);
CREATE INDEX IF NOT EXISTS idx_academic_events_type ON academic_events(type);
CREATE INDEX IF NOT EXISTS idx_academic_events_subject ON academic_events(subject);
CREATE INDEX IF NOT EXISTS idx_academic_events_event_date ON academic_events(event_date);
CREATE INDEX IF NOT EXISTS idx_academic_events_deadline ON academic_events(deadline);
CREATE INDEX IF NOT EXISTS idx_academic_events_notion_page ON academic_events(notion_page_id);

-- 2. Change History Table (Immutable Audit Log for modifications/postponements)
CREATE TABLE IF NOT EXISTS change_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES academic_events(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    field_changed TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    summary TEXT NOT NULL,
    source_message_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_history_event_id ON change_history(event_id);
CREATE INDEX IF NOT EXISTS idx_change_history_timestamp ON change_history(timestamp DESC);

-- 3. Raw Messages Table (Deduplication & Ingestion Audit)
CREATE TABLE IF NOT EXISTS raw_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'whatsapp',
    source_group TEXT,
    source_sender TEXT,
    message_text TEXT NOT NULL,
    message_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    message_hash TEXT NOT NULL UNIQUE,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_status TEXT NOT NULL DEFAULT 'PROCESSED',
    linked_event_id UUID REFERENCES academic_events(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_messages_hash ON raw_messages(message_hash);
CREATE INDEX IF NOT EXISTS idx_raw_messages_linked_event ON raw_messages(linked_event_id);

-- 4. Subject Mappings Table (Course code to friendly subject alias)
CREATE TABLE IF NOT EXISTS subject_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_code TEXT NOT NULL UNIQUE,
    subject_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subject_mappings_course_code ON subject_mappings(UPPER(course_code));

-- Pre-seed standard course codes
INSERT INTO subject_mappings (course_code, subject_name) VALUES
    ('19CSE312', 'NLP'),
    ('NLP 2026 BATCH', 'NLP'),
    ('NLP 2026', 'NLP'),
    ('23CSE351', 'FoDS'),
    ('23CSE351 FODS G1', 'FoDS'),
    ('CS301', 'OS'),
    ('CS302', 'DBMS'),
    ('CS303', 'CN'),
    ('CS304', 'AI'),
    ('MAT201', 'Mathematics')
ON CONFLICT (course_code) DO NOTHING;

-- 5. Collector Group State Table (Persistent Per-Group Cursors & Backfill Status)
CREATE TABLE IF NOT EXISTS collector_group_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_name TEXT NOT NULL,
    group_identifier TEXT NOT NULL UNIQUE,
    first_backfill_date TIMESTAMPTZ NOT NULL DEFAULT '2026-09-10T00:00:00+05:30',
    last_processed_message_timestamp TIMESTAMPTZ,
    last_processed_message_id TEXT,
    last_scan_time TIMESTAMPTZ,
    last_successful_scan_time TIMESTAMPTZ,
    backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'IDLE',
    messages_scanned INTEGER NOT NULL DEFAULT 0,
    messages_processed INTEGER NOT NULL DEFAULT 0,
    messages_ignored INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collector_group_identifier ON collector_group_state(group_identifier);
CREATE INDEX IF NOT EXISTS idx_collector_group_status ON collector_group_state(status);

-- 6. Collector Scan History Table (Track 2-Hour Scan Cycles & Metrics)
CREATE TABLE IF NOT EXISTS collector_scan_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    groups_discovered INTEGER NOT NULL DEFAULT 0,
    groups_completed INTEGER NOT NULL DEFAULT 0,
    groups_failed INTEGER NOT NULL DEFAULT 0,
    messages_scanned INTEGER NOT NULL DEFAULT 0,
    messages_processed INTEGER NOT NULL DEFAULT 0,
    messages_ignored INTEGER NOT NULL DEFAULT 0,
    events_created INTEGER NOT NULL DEFAULT 0,
    events_updated INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collector_scan_history_started ON collector_scan_history(started_at DESC);
