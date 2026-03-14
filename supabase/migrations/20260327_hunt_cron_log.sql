-- Cron health log: every cron run gets logged
CREATE TABLE IF NOT EXISTS hunt_cron_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  function_name text NOT NULL,
  status text NOT NULL DEFAULT 'success', -- 'success', 'error', 'partial'
  summary jsonb,
  error_message text,
  duration_ms int,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_log_function ON hunt_cron_log (function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_log_created ON hunt_cron_log (created_at DESC);

ALTER TABLE hunt_cron_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access cron_log" ON hunt_cron_log FOR ALL USING (true);
