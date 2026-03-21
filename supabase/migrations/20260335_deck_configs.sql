-- Saved deck configurations (panel layouts + grid preset + layer state)
CREATE TABLE IF NOT EXISTS hunt_deck_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  panels jsonb NOT NULL DEFAULT '[]',
  grid_preset text NOT NULL DEFAULT 'default',
  active_layers text[] DEFAULT '{}',
  is_builtin boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE hunt_deck_configs ENABLE ROW LEVEL SECURITY;

-- Users see their own configs + all builtins
CREATE POLICY "select_own_and_builtins" ON hunt_deck_configs
  FOR SELECT USING (user_id = auth.uid() OR is_builtin = true);

CREATE POLICY "insert_own" ON hunt_deck_configs
  FOR INSERT WITH CHECK (user_id = auth.uid() AND is_builtin = false);

CREATE POLICY "update_own" ON hunt_deck_configs
  FOR UPDATE USING (user_id = auth.uid() AND is_builtin = false);

CREATE POLICY "delete_own" ON hunt_deck_configs
  FOR DELETE USING (user_id = auth.uid() AND is_builtin = false);

-- Seed 5 built-in templates (user_id = null)
INSERT INTO hunt_deck_configs (name, panels, grid_preset, active_layers, is_builtin) VALUES
(
  'Command Center',
  '[{"panelId":"convergence","instanceId":"convergence-1","x":0,"y":0,"w":4,"h":4},{"panelId":"scout-report","instanceId":"scout-report-1","x":4,"y":0,"w":4,"h":4},{"panelId":"brain-search","instanceId":"brain-search-1","x":8,"y":0,"w":4,"h":5},{"panelId":"weather-events","instanceId":"weather-events-1","x":0,"y":4,"w":4,"h":4},{"panelId":"brain-activity","instanceId":"brain-activity-1","x":4,"y":4,"w":4,"h":4},{"panelId":"state-profile","instanceId":"state-profile-1","x":0,"y":8,"w":6,"h":6},{"panelId":"history-replay","instanceId":"history-replay-1","x":6,"y":8,"w":6,"h":4}]',
  'default',
  '{}',
  true
),
(
  'Scout Mode',
  '[{"panelId":"convergence","instanceId":"convergence-1","x":0,"y":0,"w":4,"h":4},{"panelId":"scout-report","instanceId":"scout-report-1","x":4,"y":0,"w":4,"h":4},{"panelId":"weather-events","instanceId":"weather-events-1","x":0,"y":4,"w":4,"h":4},{"panelId":"chat","instanceId":"chat-1","x":8,"y":0,"w":4,"h":6}]',
  'map-focus',
  ARRAY['ebird-clusters','flyway-corridors','wetlands','water','counties'],
  true
),
(
  'Weather Watch',
  '[{"panelId":"weather-events","instanceId":"weather-events-1","x":0,"y":0,"w":4,"h":4},{"panelId":"nws-alerts","instanceId":"nws-alerts-1","x":4,"y":0,"w":4,"h":3},{"panelId":"weather-forecast","instanceId":"weather-forecast-1","x":8,"y":0,"w":4,"h":4},{"panelId":"solunar","instanceId":"solunar-1","x":0,"y":4,"w":4,"h":3}]',
  '3-col',
  ARRAY['radar','wind-flow','isobars','nws-alerts','weather-events','temperature'],
  true
),
(
  'Migration Tracker',
  '[{"panelId":"migration-index","instanceId":"migration-index-1","x":0,"y":0,"w":4,"h":4},{"panelId":"ebird","instanceId":"ebird-1","x":4,"y":0,"w":4,"h":4},{"panelId":"du-reports","instanceId":"du-reports-1","x":8,"y":0,"w":4,"h":3},{"panelId":"screener","instanceId":"screener-1","x":0,"y":4,"w":6,"h":5}]',
  'default',
  ARRAY['ebird-heatmap','ebird-clusters','flyway-corridors','migration-front'],
  true
),
(
  'Minimal',
  '[{"panelId":"convergence","instanceId":"convergence-1","x":0,"y":0,"w":6,"h":4},{"panelId":"weather-events","instanceId":"weather-events-1","x":6,"y":0,"w":6,"h":4}]',
  '2-col',
  '{}',
  true
);
