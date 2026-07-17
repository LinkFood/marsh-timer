-- THE FORMATION LAYER v1 — formation_watches (docs/THE-WEEK.md 2026-07-17
-- pre-dawn doctrine). The map screams about what is FORMING via known-physics
-- leads fired by LIVE data; the archive supplies precedents as receipts; the
-- copy never forecasts. One row per (lead, ground) while the lead is live:
--   - hunt-formation-watch (cron 6h) opens a watch when a lead fires, keeps
--     updating evidence/copy while it stays live, marks it 'faded' when the
--     live data no longer supports it. Faded rows are never deleted — the
--     record of what was forming is part of the archive.
--   - claim_fire_id links a flood-forming watch to the court's own fire for
--     nws-flood-watch-verifies where one exists (never duplicate claim
--     machinery — the court grades, this table only points at the docket).

CREATE TABLE IF NOT EXISTS formation_watches (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id       text NOT NULL,               -- 'flood-forming' | 'smoke-forming'
  states        text[] NOT NULL,             -- postal abbrs the lead is live over
  status        text NOT NULL DEFAULT 'forming'
                CHECK (status IN ('forming', 'faded')),
  opened_at     date NOT NULL,               -- the day the lead first fired
  last_seen     date NOT NULL,               -- last day the lead was still live
  faded_at      date,                        -- null while forming
  evidence      jsonb NOT NULL,              -- the live facts that fired the lead
  precedents    jsonb,                       -- archive receipts; null = honest "record too short"
  copy          text NOT NULL,               -- the fact-only sentence, prebuilt server-side
  claim_fire_id uuid REFERENCES hunt_claim_fires(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One open watch per (lead, ground) — the updater keys on this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_watches_open
  ON formation_watches (lead_id, states)
  WHERE status = 'forming';

CREATE INDEX IF NOT EXISTS idx_formation_watches_status
  ON formation_watches (status, opened_at DESC);

-- Anon read exposure — the porch, the board, and /morning read this table
-- directly through the anon client (mirrors morning_lines / board_rhymes).
-- Writes come only from the service role (bypasses RLS).
ALTER TABLE formation_watches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read formation_watches" ON formation_watches;
CREATE POLICY "Public read formation_watches" ON formation_watches FOR SELECT USING (true);
GRANT SELECT ON formation_watches TO anon, authenticated;
