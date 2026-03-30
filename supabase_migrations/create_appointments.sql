-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS appointments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  start_time     TIMESTAMPTZ NOT NULL,
  summary        TEXT,
  reminder_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appointments_business_id_idx ON appointments (business_id);
CREATE INDEX IF NOT EXISTS appointments_start_time_idx  ON appointments (start_time);
CREATE INDEX IF NOT EXISTS appointments_reminder_idx    ON appointments (reminder_sent, start_time)
  WHERE reminder_sent = FALSE;
