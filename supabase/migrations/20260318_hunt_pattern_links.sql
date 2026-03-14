-- Pattern links: real-time connections between data points
-- Written by query-on-write when new data matches historical patterns
CREATE TABLE IF NOT EXISTS hunt_pattern_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES hunt_knowledge(id) ON DELETE CASCADE,
  matched_id uuid NOT NULL REFERENCES hunt_knowledge(id) ON DELETE CASCADE,
  similarity float NOT NULL,
  source_content_type text,
  matched_content_type text,
  state_abbr text,
  created_at timestamptz DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_pattern_links_source ON hunt_pattern_links (source_id);
CREATE INDEX IF NOT EXISTS idx_pattern_links_state ON hunt_pattern_links (state_abbr, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_links_created ON hunt_pattern_links (created_at DESC);

-- RLS
ALTER TABLE hunt_pattern_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_pattern_links FOR ALL USING (true);

-- RPC to get recent pattern links for a state (what the map/chat reads)
CREATE OR REPLACE FUNCTION get_recent_pattern_links(
  p_state_abbr text DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_hours_back int DEFAULT 72
)
RETURNS TABLE (
  id uuid,
  source_id uuid,
  source_title text,
  source_content_type text,
  matched_id uuid,
  matched_title text,
  matched_content_type text,
  matched_content text,
  similarity float,
  state_abbr text,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pl.id,
    pl.source_id,
    ks.title AS source_title,
    pl.source_content_type,
    pl.matched_id,
    km.title AS matched_title,
    pl.matched_content_type,
    km.content AS matched_content,
    pl.similarity,
    pl.state_abbr,
    pl.created_at
  FROM hunt_pattern_links pl
  JOIN hunt_knowledge ks ON ks.id = pl.source_id
  JOIN hunt_knowledge km ON km.id = pl.matched_id
  WHERE
    (p_state_abbr IS NULL OR pl.state_abbr = p_state_abbr)
    AND pl.created_at > now() - (p_hours_back || ' hours')::interval
  ORDER BY pl.created_at DESC
  LIMIT p_limit;
END;
$$;
