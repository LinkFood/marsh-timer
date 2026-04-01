-- Temporary function to check RLS status
CREATE OR REPLACE FUNCTION public.check_rls_status()
RETURNS TABLE(table_name text, rls_enabled boolean)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT tablename::text, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY rowsecurity, tablename;
$$;
