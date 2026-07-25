-- Revoke TRUNCATE from anon and authenticated on every table in public.
--
-- CLUSTER-WIDE. This shared Postgres instance hosts DCD (hunt_*, board_*),
-- JAC (ct_*, unprefixed) and Lupa (lupa_*). This migration deliberately covers
-- all of them, because the hole is a property of the cluster's default grants,
-- not of any one project.
--
-- Found 2026-07-25 while answering "if the archive had been truncated, would we
-- have survived it." Measured before applying: 248 tables in the public schema
-- carried TRUNCATE for anon, including hunt_knowledge (~10M rows, 68 GB — the
-- entire two-year archive), hunt_weather_history, hunt_seasons, morning_lines,
-- planting_climatology, and every ct_* and lupa_* table.
--
-- Why this is the privilege that matters: TRUNCATE is NOT subject to row-level
-- security. Every "RLS is enabled with a SELECT-only policy" table in this
-- cluster was therefore still destroyable in a single statement by anyone
-- holding a publishable key — and those keys ship in the browser bundles of
-- duckcountdown.com, linkjac.cloud and lupa.ink. RLS was never protecting
-- against this and could not.
--
-- Blast radius if it had been used: PITR is OFF on this project (verified via
-- the Management API). Coverage is 7 daily physical backups taken ~08:40 UTC
-- with 7-day retention, and they are whole-cluster — restoring DCD would roll
-- JAC and Lupa back to the same timestamp. Worst case was ~24h of loss across
-- three projects at once.
--
-- Why revoking is safe: no browser client truncates a table. TRUNCATE has no
-- legitimate use from anon or authenticated in any of the three applications.
-- Service-role writers (edge functions, cron jobs, offline bake scripts) are
-- unaffected — service_role bypasses both RLS and these grants.
--
-- Deliberately NOT touched here: INSERT/UPDATE/DELETE grants. On tables with
-- RLS enabled those are the normal Supabase posture, with policies doing the
-- filtering. Four tables were measured as RLS-off WITH live anon writes —
-- ct_butterfly_cross_events, ct_d3_feature_observations, ct_mcp_tool_calls,
-- ct_specialist_wakeup_log — all dead Co-Trader tables. Those belong to JAC and
-- are left for that project to rule on rather than changed from this repo.

DO $body$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated', r.relname);
  END LOOP;
END
$body$;
