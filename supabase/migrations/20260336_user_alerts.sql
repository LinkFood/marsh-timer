-- User-configurable alerts
CREATE TABLE IF NOT EXISTS hunt_user_alerts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  trigger_type text NOT NULL, -- 'score_spike', 'weather_event', 'threshold', 'new_data'
  config jsonb NOT NULL DEFAULT '{}',
  states text[] DEFAULT NULL, -- state abbreviations to monitor (null = all states)
  species text DEFAULT 'duck',
  enabled boolean DEFAULT true,
  check_interval text DEFAULT '3hr',
  last_fired_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE hunt_user_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_alerts" ON hunt_user_alerts
  FOR ALL USING (user_id = auth.uid());

-- Alert history / notifications
CREATE TABLE IF NOT EXISTS hunt_user_alert_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id uuid REFERENCES hunt_user_alerts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb DEFAULT '{}',
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE hunt_user_alert_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_see_own_alert_history" ON hunt_user_alert_history
  FOR ALL USING (user_id = auth.uid());

-- Index for fast unread count
CREATE INDEX idx_alert_history_unread ON hunt_user_alert_history (user_id, read) WHERE read = false;

-- Index for cron to find due alerts
CREATE INDEX idx_user_alerts_enabled ON hunt_user_alerts (enabled) WHERE enabled = true;
