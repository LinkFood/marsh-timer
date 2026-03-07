-- Auth, chat, and task tables for DuckCountdown
-- Shares Supabase project with JAC Agent OS — all prefixed hunt_

-- hunt_profiles (auto-created via trigger on auth.users INSERT)
CREATE TABLE hunt_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hunt_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON hunt_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON hunt_profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create hunt_profile on signup
CREATE OR REPLACE FUNCTION create_hunt_profile()
RETURNS trigger AS $$
BEGIN
  INSERT INTO hunt_profiles (user_id, display_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_hunt
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_hunt_profile();

-- hunt_user_settings
CREATE TABLE hunt_user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}',
  species_preferences text[] NOT NULL DEFAULT '{"duck"}',
  state_preferences text[] NOT NULL DEFAULT '{}',
  daily_query_count int NOT NULL DEFAULT 0,
  daily_query_reset date NOT NULL DEFAULT CURRENT_DATE,
  tier text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hunt_user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own settings" ON hunt_user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own settings" ON hunt_user_settings FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create settings row on profile creation
CREATE OR REPLACE FUNCTION create_hunt_user_settings()
RETURNS trigger AS $$
BEGIN
  INSERT INTO hunt_user_settings (user_id) VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_hunt_profile_created
  AFTER INSERT ON hunt_profiles
  FOR EACH ROW EXECUTE FUNCTION create_hunt_user_settings();

-- hunt_conversations (chat history)
CREATE TABLE hunt_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hunt_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own conversations" ON hunt_conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role insert conversations" ON hunt_conversations FOR INSERT WITH CHECK (true);

CREATE INDEX idx_hunt_conversations_user_session ON hunt_conversations(user_id, session_id, created_at);

-- hunt_tasks (token/cost tracking)
CREATE TABLE hunt_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'chat',
  status text NOT NULL DEFAULT 'completed',
  input jsonb DEFAULT '{}',
  output jsonb DEFAULT '{}',
  cost_usd numeric(10, 6) DEFAULT 0,
  tokens_in int DEFAULT 0,
  tokens_out int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hunt_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own tasks" ON hunt_tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role insert tasks" ON hunt_tasks FOR INSERT WITH CHECK (true);

-- Add RLS to hunt_user_locations (was missing)
ALTER TABLE hunt_user_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own locations" ON hunt_user_locations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own locations" ON hunt_user_locations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own locations" ON hunt_user_locations FOR DELETE USING (auth.uid() = user_id);

-- Vector search RPC for hunt_knowledge
SET search_path = public, extensions;
CREATE OR REPLACE FUNCTION search_hunt_knowledge_by_embedding(
  query_embedding vector(512),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  content_type text,
  tags text[],
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    hk.id,
    hk.title,
    hk.content,
    hk.content_type,
    hk.tags,
    1 - (hk.embedding <=> query_embedding) AS similarity
  FROM hunt_knowledge hk
  WHERE 1 - (hk.embedding <=> query_embedding) > match_threshold
  ORDER BY hk.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
RESET search_path;

-- HNSW index on hunt_knowledge embeddings
SET search_path = public, extensions;
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_embedding
  ON hunt_knowledge USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
RESET search_path;
