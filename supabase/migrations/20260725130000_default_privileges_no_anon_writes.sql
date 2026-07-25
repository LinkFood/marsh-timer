-- Stop new tables being born with anon write privileges.
--
-- CLUSTER-WIDE and forward-looking. 20260725000500 revoked anon TRUNCATE across
-- 248 existing tables and 20260725001500 revoked anon writes across the DCD
-- tables — but both were point-in-time fixes. Creating era5_state_pressure and
-- era5_sampling_points minutes later reopened the hole immediately: both tables
-- arrived with anon holding INSERT, UPDATE, DELETE and TRUNCATE, because the
-- schema's DEFAULT ACL grants them.
--
-- Measured before applying, from pg_default_acl on schema public:
--   grantor postgres,        objtype r → anon=arwdDxtm/postgres
--   grantor supabase_admin,  objtype r → anon=arwdDxtm/supabase_admin
-- where a=INSERT r=SELECT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER.
--
-- So every future table in public would inherit full write access for the
-- publishable keys that ship in the browser bundles of duckcountdown.com,
-- linkjac.cloud and lupa.ink — and TRUNCATE is not subject to row-level
-- security, so no policy could contain it.
--
-- This changes the DEFAULT, which is the only durable fix. SELECT is left in
-- place: public read is the intended posture here and the sites render from
-- these tables with the anon key. service_role is untouched and bypasses both
-- RLS and grants, so every edge function, cron and bake script is unaffected.
--
-- If a future table genuinely needs anon writes, grant it explicitly on that
-- table, the way lupa_failures does for its flag button. Explicit is the point.

-- Only the `postgres` grantor is changed here. The equivalent statement FOR ROLE
-- supabase_admin fails with 42501 (permission denied to change default
-- privileges) — the migration connection is `postgres`, which is not a member of
-- supabase_admin, and no available connection is. Migrations and the CLI create
-- tables as `postgres`, so this covers every table this repo will ever add.
-- Tables created by supabase_admin — dashboard-authored ones, principally —
-- still inherit the old default and must be revoked explicitly. That residue is
-- named in docs/ rather than left to be rediscovered.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon, authenticated;

-- And close the two tables that were already created under the old default.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.era5_state_pressure  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.era5_sampling_points FROM anon, authenticated;
