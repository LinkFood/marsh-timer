-- Enable RLS on all hunt_ tables that are missing it.
-- Edge functions use service_role (bypasses RLS) — won't break.
-- Frontend uses anon key — needs SELECT policies on tables it reads directly.

-- ============================================================
-- DATA TABLES: Enable RLS + anon SELECT (read-only public data)
-- ============================================================

-- THE BRAIN
ALTER TABLE IF EXISTS hunt_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_knowledge" ON hunt_knowledge FOR SELECT TO anon, authenticated USING (true);

-- Alert & grading system
ALTER TABLE IF EXISTS hunt_alert_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_alert_outcomes" ON hunt_alert_outcomes FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_alert_calibration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_alert_calibration" ON hunt_alert_calibration FOR SELECT TO anon, authenticated USING (true);

-- Convergence
ALTER TABLE IF EXISTS hunt_convergence_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_convergence_scores" ON hunt_convergence_scores FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_convergence_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_convergence_alerts" ON hunt_convergence_alerts FOR SELECT TO anon, authenticated USING (true);

-- BirdCast
ALTER TABLE IF EXISTS hunt_birdcast ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_birdcast" ON hunt_birdcast FOR SELECT TO anon, authenticated USING (true);

-- Cron logs (ops dashboard reads these)
ALTER TABLE IF EXISTS hunt_cron_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_cron_log" ON hunt_cron_log FOR SELECT TO anon, authenticated USING (true);

-- Web discoveries (admin panel reads these)
ALTER TABLE IF EXISTS hunt_web_discoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_web_discoveries" ON hunt_web_discoveries FOR SELECT TO anon, authenticated USING (true);

-- Pattern links
ALTER TABLE IF EXISTS hunt_pattern_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_pattern_links" ON hunt_pattern_links FOR SELECT TO anon, authenticated USING (true);

-- Migration history
ALTER TABLE IF EXISTS hunt_migration_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_migration_history" ON hunt_migration_history FOR SELECT TO anon, authenticated USING (true);

-- Weather history
ALTER TABLE IF EXISTS hunt_weather_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_weather_history" ON hunt_weather_history FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- REFERENCE TABLES: Enable RLS + anon SELECT (static data)
-- ============================================================

ALTER TABLE IF EXISTS hunt_seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_seasons" ON hunt_seasons FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_species ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_species" ON hunt_species FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_states" ON hunt_states FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_state_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_state_facts" ON hunt_state_facts FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_zones" ON hunt_zones FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_regulation_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_regulation_links" ON hunt_regulation_links FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- INTERNAL TABLES: Enable RLS, NO anon access (service_role only)
-- ============================================================

ALTER TABLE IF EXISTS hunt_logs ENABLE ROW LEVEL SECURITY;
-- No policy = only service_role can access

ALTER TABLE IF EXISTS hunt_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_feedback" ON hunt_feedback FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_intel_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_intel_briefs" ON hunt_intel_briefs FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_score_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_score_history" ON hunt_score_history FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_solunar_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_solunar_cache" ON hunt_solunar_cache FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_weather_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_weather_cache" ON hunt_weather_cache FOR SELECT TO anon, authenticated USING (true);

-- DU data tables
ALTER TABLE IF EXISTS hunt_du_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_du_articles" ON hunt_du_articles FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_du_map_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_du_map_reports" ON hunt_du_map_reports FOR SELECT TO anon, authenticated USING (true);

-- USFWS tables
ALTER TABLE IF EXISTS hunt_usfws_breeding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_usfws_breeding" ON hunt_usfws_breeding FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_usfws_harvest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_usfws_harvest" ON hunt_usfws_harvest FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS hunt_usfws_hip ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_usfws_hip" ON hunt_usfws_hip FOR SELECT TO anon, authenticated USING (true);

-- Deck configs (user-specific but frontend reads via anon)
ALTER TABLE IF EXISTS hunt_deck_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_deck_configs" ON hunt_deck_configs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated_manage_deck_configs" ON hunt_deck_configs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Solunar precomputed (only if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'hunt_solunar_precomputed') THEN
    ALTER TABLE hunt_solunar_precomputed ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "anon_read_solunar_precomputed" ON hunt_solunar_precomputed FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;
