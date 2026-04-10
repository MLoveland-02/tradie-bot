-- ─────────────────────────────────────────────────────────────────────────────
-- add_voice_columns.sql
--
-- Run this in the Supabase SQL editor (or via the Supabase CLI).
-- Adds voice call support columns to businesses and conversations.
-- All changes are additive / non-breaking.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── businesses ────────────────────────────────────────────────────────────────

-- TTS voice used when the AI speaks on inbound calls.
-- Valid values match OpenAI TTS voices: alloy | echo | nova | shimmer
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS voice_preference TEXT NOT NULL DEFAULT 'nova'
  CHECK (voice_preference IN ('alloy', 'echo', 'nova', 'shimmer'));

-- ── conversations ─────────────────────────────────────────────────────────────

-- Twilio CallSid for the active (or most recent) voice call on this conversation.
-- Used by the status callback to locate the conversation without the in-memory Map
-- (handles server restarts mid-call).
-- Cleared back to NULL when the call ends.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS call_sid TEXT;

-- AI-generated summary of the call, stored when the call ends.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS call_summary TEXT;

-- Index for fast status-callback lookup: find conversation by call_sid
CREATE INDEX IF NOT EXISTS conversations_call_sid_idx
  ON conversations (call_sid)
  WHERE call_sid IS NOT NULL;

-- ── Status value used while a call is active ──────────────────────────────────
-- The conversations.status column already exists.
-- 'call_active' is a new value written during a live call.
-- No schema change needed if the column is TEXT (no enum constraint).
-- If you have a CHECK constraint on status, add 'call_active' to it:
--
--   ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
--   ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
--     CHECK (status IN ('open', 'missed_call', 'booked', 'call_active'));
