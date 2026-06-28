-- Migration 011: kg_query_safe — a guarded, read-only SQL tool for the agent.
-- Lets the Claude tool-loop answer ad-hoc aggregate questions the curated kg_*
-- tools don't cover, with NO write path:
--   * single statement only (no semicolons)
--   * SELECT / WITH only, with a forbidden-keyword backstop
--   * SECURITY DEFINER owned by the low-privilege clayos_readonly role, so it can
--     only read what clayos_readonly can (SELECT on the clayos schema) — a crafted
--     read of auth.*/pg_authid/etc. fails with permission denied
--   * 5s statement_timeout + 500-row cap
-- Returns jsonb (rows) or {"error": "..."}.  Additive — safe to apply anytime.
-- ─────────────────────────────────────────────────────────────────────────────
SET search_path TO clayos, public, extensions;

-- make the migration runner a member of clayos_readonly so it can reassign owner
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    BEGIN EXECUTE format('GRANT clayos_readonly TO %I', current_user); EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION clayos.kg_query_safe(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clayos, public, extensions
AS $$
DECLARE
  v_sql  text := btrim(p_sql);
  v_norm text := upper(btrim(p_sql));
  v_res  jsonb;
BEGIN
  IF v_sql = '' THEN RAISE EXCEPTION 'empty query'; END IF;
  IF position(';' IN v_sql) > 0 THEN RAISE EXCEPTION 'single statement only (no semicolons)'; END IF;
  IF left(v_norm, 6) <> 'SELECT' AND left(v_norm, 4) <> 'WITH' THEN
    RAISE EXCEPTION 'only SELECT / WITH queries are allowed';
  END IF;
  IF v_norm ~ '\m(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|MERGE|CALL|VACUUM|REINDEX|REFRESH|ATTACH)\M' THEN
    RAISE EXCEPTION 'query contains a forbidden keyword';
  END IF;
  SET LOCAL statement_timeout = '5s';
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(_q)), ''[]''::jsonb) '
       || 'FROM (SELECT * FROM (' || v_sql || ') _inner LIMIT 500) _q'
    INTO v_res;
  RETURN v_res;
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;

-- run with clayos_readonly's privileges (definer = owner). The new owner needs
-- CREATE on the schema to own an object in it (harmless: clayos_readonly is
-- NOLOGIN and used only as this SELECT-only function's definer).
GRANT CREATE ON SCHEMA clayos TO clayos_readonly;
ALTER FUNCTION clayos.kg_query_safe(text) OWNER TO clayos_readonly;
GRANT EXECUTE ON FUNCTION clayos.kg_query_safe(text) TO PUBLIC;
