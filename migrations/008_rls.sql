-- Migration 008: grants + read-only role.
--
-- POC posture: synthetic data, permissive READ. Full RLS scoping (field user vs.
-- exec, per-business-unit) is Phase 2 — see docs/ROADMAP.md. What matters now is
-- the `clayos_readonly` role that the agent's text-to-SQL tool (kg_query) runs as,
-- so free SQL can never write.
--
-- Portable: role/grant statements are guarded so this is a no-op-safe on local PG
-- (where anon/authenticated/service_role don't exist) and on Supabase.
--
-- SUPABASE PROVISIONING NOTE: to expose the `clayos` schema over PostgREST, add
-- `clayos` to the project's "Exposed schemas" (Dashboard → API), or:
--   ALTER ROLE authenticator SET pgrst.db_schemas = 'public,clayos,graphql_public';
--   NOTIFY pgrst, 'reload config';
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

-- ─── Read-only role for agent text-to-SQL (kg_query) ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clayos_readonly') THEN
    CREATE ROLE clayos_readonly NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA clayos TO clayos_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA clayos TO clayos_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA clayos GRANT SELECT ON TABLES TO clayos_readonly;
-- read-only RPCs the agent may call
GRANT EXECUTE ON FUNCTION clayos.kg_traverse(uuid, int, text[])         TO clayos_readonly;
GRANT EXECUTE ON FUNCTION clayos.kg_subgraph(uuid, text[], text[], int)  TO clayos_readonly;
GRANT EXECUTE ON FUNCTION clayos.kg_neighbors(uuid)                      TO clayos_readonly;
GRANT EXECUTE ON FUNCTION clayos.kg_search(vector, int, uuid, text[])    TO clayos_readonly;
GRANT EXECUTE ON FUNCTION clayos.kg_project_kpis(uuid)                   TO clayos_readonly;

-- ─── Supabase API roles (only if present) ───────────────────────────────────
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA clayos TO %I', r);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA clayos TO %I', r);
      EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA clayos TO %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA clayos GRANT SELECT ON TABLES TO %I', r);
    END IF;
  END LOOP;
  -- service_role also needs write (edge functions: projection, embeddings, seed).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON ALL TABLES IN SCHEMA clayos TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA clayos TO service_role;
  END IF;
END $$;
