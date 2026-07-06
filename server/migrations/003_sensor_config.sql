-- ─── Sensor Configuration ────────────────────────────────────
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
