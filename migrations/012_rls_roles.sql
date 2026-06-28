-- Migration 012: role-scoping SCAFFOLDING (field vs. exec) — NON-BREAKING.
-- Creates the roles + a JWT-claim helper and documents the enable-path, but does
-- NOT enable RLS on any table, so the anon-key live app keeps reading everything.
-- Turning on enforcement is a deliberate, tested follow-up (see the block at end).
-- Applied to LOCAL only for now; do not enable on the live demo without verifying
-- the anon read path still works.
-- ─────────────────────────────────────────────────────────────────────────────
SET search_path TO clayos, public, extensions;

-- two illustrative app personas
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clayos_field') THEN CREATE ROLE clayos_field NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clayos_exec')  THEN CREATE ROLE clayos_exec  NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA clayos TO clayos_field, clayos_exec;
GRANT SELECT ON ALL TABLES IN SCHEMA clayos TO clayos_field, clayos_exec;

-- read the app persona + scoped business unit from the request JWT (Supabase sets
-- request.jwt.claims). Defaults to 'exec' / no-scope when unset, so existing anon
-- reads are unchanged until policies are enabled.
CREATE OR REPLACE FUNCTION clayos.app_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'clayos_role', ''),
    'exec');
$$;
CREATE OR REPLACE FUNCTION clayos.app_bu() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'clayos_bu', '')::uuid;
$$;
GRANT EXECUTE ON FUNCTION clayos.app_role(), clayos.app_bu() TO PUBLIC;

-- ── Enable-path (run deliberately, then verify anon/app reads) ────────────────
-- Example: scope field personas to their business unit on the operational tables,
-- while exec sees everything. Pattern, NOT executed here:
--
--   ALTER TABLE clayos.daily_logs ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY daily_logs_scope ON clayos.daily_logs FOR SELECT USING (
--     clayos.app_role() = 'exec'
--     OR project_id IN (SELECT id FROM clayos.projects WHERE business_unit_id = clayos.app_bu())
--   );
--   -- repeat for rfis, safety_events, quality_events, submittals, schedule_activities…
--
-- Until those run, RLS is OFF and the anon key reads the full demo dataset.
