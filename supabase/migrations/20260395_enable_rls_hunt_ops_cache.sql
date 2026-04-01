-- Enable RLS on hunt_ops_cache (flagged by Supabase security audit)
-- This table is only accessed by edge functions using service_role key,
-- so no anon/authenticated policies needed.
ALTER TABLE public.hunt_ops_cache ENABLE ROW LEVEL SECURITY;

-- Drop the temp RLS check function
DROP FUNCTION IF EXISTS public.check_rls_status();
