-- Create DU table if it doesn't exist (the 20260324 migration may have partially run)
CREATE TABLE IF NOT EXISTS hunt_knowledge_du (LIKE hunt_knowledge INCLUDING ALL);
ALTER TABLE hunt_knowledge_du ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access du" ON hunt_knowledge_du;
CREATE POLICY "Service role full access du" ON hunt_knowledge_du FOR ALL USING (true);
