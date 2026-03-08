SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS hunt_du_articles (
  uuid text PRIMARY KEY,
  title text NOT NULL,
  article_date timestamptz NOT NULL,
  url text NOT NULL,
  teaser text,
  states text[] DEFAULT '{}',
  body text,
  embedded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_hunt_du_articles_date ON hunt_du_articles (article_date DESC);

ALTER TABLE hunt_du_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_du_articles FOR ALL USING (true) WITH CHECK (true);

RESET search_path;
