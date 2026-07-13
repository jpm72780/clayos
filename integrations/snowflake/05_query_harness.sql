-- 05_query_harness.sql — the guarded agent query path, ported from clayos migration 011
-- (kg_query_safe). Same defense-in-depth idea, Snowflake mechanics:
--
--   Layer 1 (structural): CLAYOS_AGENT role has SELECT on SCH_CLAYOS_SEMANTIC ONLY.
--            No grants on raw schemas, so even a validation bypass cannot read
--            SCH_PROJECT_OPERATIONS or anything _SENSITIVE.
--   Layer 2 (validation): RUN_GUARDED_QUERY() rejects multi-statement / non-SELECT /
--            known-DDL-DML keywords, wraps in LIMIT 500 — mirroring kg_query_safe.
--   Layer 3 (resource):   WH_CLAYOS_XS STATEMENT_TIMEOUT 60s (00) + a 15s session cap here,
--            resource monitor suspend at quota.
--
-- The agent runtime connects AS the CLAYOS_AGENT role (or Cortex Agents call this proc).
-- Role: CLAYOS_BUILDER to create; CLAYOS_AGENT to execute.

USE ROLE CLAYOS_BUILDER;
USE WAREHOUSE WH_CLAYOS_XS;
USE SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC;

-- ═══ Finalize agent grants (objects now exist) ════════════════════════════════
GRANT SELECT ON ALL TABLES         IN SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC TO ROLE CLAYOS_AGENT;
GRANT SELECT ON ALL DYNAMIC TABLES IN SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC TO ROLE CLAYOS_AGENT;
GRANT SELECT ON ALL VIEWS          IN SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC TO ROLE CLAYOS_AGENT;
GRANT SELECT ON FUTURE TABLES      IN SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC TO ROLE CLAYOS_AGENT;
GRANT SELECT ON FUTURE VIEWS       IN SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC TO ROLE CLAYOS_AGENT;
-- Deliberately NOT granted to CLAYOS_AGENT: PILOT-slate writes, INTEGRATION_RUNS writes,
-- anything outside this schema.

-- ═══ The guarded query procedure (validation mirror of kg_query_safe) ═════════
-- EXECUTE AS CALLER: privileges come from the calling role (CLAYOS_AGENT), so the
-- structural Layer 1 boundary holds even inside the proc.
CREATE OR REPLACE PROCEDURE RUN_GUARDED_QUERY(SQL_TEXT STRING)
RETURNS VARIANT
LANGUAGE JAVASCRIPT
EXECUTE AS CALLER
AS
$$
  var sql = (SQL_TEXT || "").trim();

  // single statement only (same check as kg_query_safe): no semicolons except one trailing
  sql = sql.replace(/;\s*$/, "");
  if (sql.indexOf(";") !== -1)  return { error: "multiple statements are not allowed" };

  // must be a bare SELECT / WITH
  if (!/^\s*(select|with)\b/i.test(sql)) return { error: "only SELECT queries are allowed" };

  // keyword backstop (mirrors migration 011's regex; Snowflake-relevant additions included)
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|merge|call|undrop|put|get|remove|use|execute\s+task)\b/i.test(sql))
    return { error: "statement contains a disallowed keyword" };

  // stay inside the semantic schema: block explicit references to other schemas
  if (/\bsch_project_operations\b|\bsch_sales_and_marketing_ltd\b|\binformation_schema\b|\bsnowflake\./i.test(sql))
    return { error: "queries must target SCH_CLAYOS_SEMANTIC objects only" };

  // row + time caps (LIMIT 500 wrapper + 15s session timeout, like 011's 5s/500)
  try {
    snowflake.execute({ sqlText: "ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 15" });
    var rs = snowflake.execute({ sqlText: "SELECT * FROM (" + sql + ") LIMIT 500" });
    var cols = [];
    for (var i = 1; i <= rs.getColumnCount(); i++) cols.push(rs.getColumnName(i));
    var rows = [];
    while (rs.next() && rows.length < 500) {
      var r = {};
      for (var j = 0; j < cols.length; j++) r[cols[j]] = rs.getColumnValue(j + 1);
      rows.push(r);
    }
    return { columns: cols, rows: rows, row_count: rows.length, truncated: rows.length === 500 };
  } catch (err) {
    return { error: String(err.message || err) };
  }
$$;

GRANT USAGE ON PROCEDURE RUN_GUARDED_QUERY(STRING) TO ROLE CLAYOS_AGENT;

-- ═══ Guard tests (run as CLAYOS_AGENT — plan exit criterion for Phase 2) ══════
-- USE ROLE CLAYOS_AGENT;
-- CALL RUN_GUARDED_QUERY('SELECT PROJECT_NUMBER, CPI_CF FROM KPI_EVM ORDER BY CPI_CF');   -- ok
-- CALL RUN_GUARDED_QUERY('DELETE FROM PILOT_PROJECTS');                                   -- rejected (keyword)
-- CALL RUN_GUARDED_QUERY('SELECT 1; SELECT 2');                                           -- rejected (multi)
-- CALL RUN_GUARDED_QUERY('SELECT * FROM SCH_PROJECT_OPERATIONS.DT_PROJECTS');             -- rejected (schema)
-- SELECT * FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_PROJECTS LIMIT 1;              -- FAILS: no grant (Layer 1)

-- ═══ Cortex Search (entity semantic search — replaces pgvector, vectors never leave SF)
-- Create once Cortex availability is confirmed by 01's probe:
-- CREATE OR REPLACE CORTEX SEARCH SERVICE ENTITY_SEARCH
--   ON LABEL
--   ATTRIBUTES ENTITY_TYPE, PROJECT_NUMBER, BUSINESS_UNIT
--   WAREHOUSE = WH_CLAYOS_XS
--   TARGET_LAG = '1 day'
--   AS SELECT ENTITY_ID, ENTITY_TYPE, LABEL, PROJECT_NUMBER, BUSINESS_UNIT FROM ENTITIES;
-- GRANT USAGE ON CORTEX SEARCH SERVICE ENTITY_SEARCH TO ROLE CLAYOS_AGENT;
