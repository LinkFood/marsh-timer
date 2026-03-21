-- Replace builtin deck templates with environmental intelligence framing
DELETE FROM hunt_deck_configs WHERE is_builtin = true;

INSERT INTO hunt_deck_configs (name, panels, grid_preset, active_layers, is_builtin) VALUES
(
  'Command Center',
  '[{"panelId":"convergence","instanceId":"convergence-1","x":0,"y":0,"w":4,"h":4},{"panelId":"scout-report","instanceId":"scout-report-1","x":4,"y":0,"w":4,"h":4},{"panelId":"brain-search","instanceId":"brain-search-1","x":8,"y":0,"w":4,"h":5},{"panelId":"weather-events","instanceId":"weather-events-1","x":0,"y":4,"w":4,"h":4},{"panelId":"brain-activity","instanceId":"brain-activity-1","x":4,"y":4,"w":4,"h":4},{"panelId":"hunt-alerts","instanceId":"hunt-alerts-1","x":8,"y":5,"w":4,"h":3}]',
  'default',
  '{}',
  true
),
(
  'Weather Station',
  '[{"panelId":"weather-events","instanceId":"weather-events-1","x":0,"y":0,"w":4,"h":4},{"panelId":"nws-alerts","instanceId":"nws-alerts-1","x":4,"y":0,"w":4,"h":3},{"panelId":"weather-forecast","instanceId":"weather-forecast-1","x":8,"y":0,"w":4,"h":4},{"panelId":"convergence-history","instanceId":"convergence-history-1","x":0,"y":4,"w":6,"h":4},{"panelId":"history-replay","instanceId":"history-replay-1","x":6,"y":4,"w":6,"h":4}]',
  '3-col',
  ARRAY['radar','wind-flow','isobars','nws-alerts','weather-events','temperature','pressure-trends'],
  true
),
(
  'Wildlife Monitor',
  '[{"panelId":"migration-index","instanceId":"migration-index-1","x":0,"y":0,"w":4,"h":4},{"panelId":"ebird","instanceId":"ebird-1","x":4,"y":0,"w":4,"h":4},{"panelId":"solunar","instanceId":"solunar-1","x":8,"y":0,"w":4,"h":3},{"panelId":"du-reports","instanceId":"du-reports-1","x":0,"y":4,"w":4,"h":3},{"panelId":"convergence","instanceId":"convergence-1","x":4,"y":4,"w":4,"h":4}]',
  'default',
  ARRAY['ebird-heatmap','ebird-clusters','flyway-corridors','migration-front','du-pins'],
  true
),
(
  'Hunting Mode',
  '[{"panelId":"convergence","instanceId":"convergence-1","x":0,"y":0,"w":4,"h":4},{"panelId":"scout-report","instanceId":"scout-report-1","x":4,"y":0,"w":4,"h":4},{"panelId":"hunt-alerts","instanceId":"hunt-alerts-1","x":8,"y":0,"w":4,"h":3},{"panelId":"state-profile","instanceId":"state-profile-1","x":0,"y":4,"w":6,"h":6},{"panelId":"solunar","instanceId":"solunar-1","x":6,"y":4,"w":3,"h":3},{"panelId":"ebird","instanceId":"ebird-1","x":9,"y":4,"w":3,"h":4}]',
  'default',
  ARRAY['ebird-clusters','flyway-corridors','wetlands','water-bodies','counties','convergence-heatmap','convergence-pulse'],
  true
),
(
  'Minimal',
  '[{"panelId":"convergence","instanceId":"convergence-1","x":0,"y":0,"w":6,"h":4},{"panelId":"brain-search","instanceId":"brain-search-1","x":6,"y":0,"w":6,"h":5}]',
  '2-col',
  '{}',
  true
),
(
  'Research',
  '[{"panelId":"brain-search","instanceId":"brain-search-1","x":0,"y":0,"w":4,"h":5},{"panelId":"history-replay","instanceId":"history-replay-1","x":4,"y":0,"w":4,"h":4},{"panelId":"convergence-history","instanceId":"convergence-history-1","x":8,"y":0,"w":4,"h":4},{"panelId":"screener","instanceId":"screener-1","x":0,"y":5,"w":6,"h":5},{"panelId":"brain-activity","instanceId":"brain-activity-1","x":6,"y":4,"w":6,"h":4}]',
  'default',
  ARRAY['convergence-heatmap','convergence-pulse'],
  true
);
