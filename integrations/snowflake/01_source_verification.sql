-- 01_source_verification.sql — run BEFORE building anything. Answers the five mapping
-- questions from the plan, introspects the columns the later scripts assume, asserts
-- the broken/stale objects stay excluded, and probes sensitive-data isolation + Cortex.
-- Record answers in README.md "Verified facts". Role: CLAYOS_BUILDER.

USE ROLE CLAYOS_BUILDER;
USE WAREHOUSE WH_CLAYOS_XS;
USE DATABASE DB_CONTROL_TOWER;
USE SCHEMA SCH_PROJECT_OPERATIONS;

-- ═══ Q1: Does a forecast/EAC measure exist in cost management? ═══════════════
-- (Decides whether EV_CF = BAC × AC/EAC is computable — the recommended default basis.)
SELECT COLUMN_NAME, DATA_TYPE
FROM DB_CONTROL_TOWER.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'SCH_PROJECT_OPERATIONS'
  AND TABLE_NAME IN ('DT_COST_MANAGEMENT', 'DT_COST_MANAGEMENT_APPROVED', 'DT_COST_MANAGEMENT_BY_DAY')
  AND (COLUMN_NAME ILIKE '%FORECAST%' OR COLUMN_NAME ILIKE '%EAC%' OR COLUMN_NAME ILIKE '%ESTIMATE%AT%'
       OR COLUMN_NAME ILIKE '%PROJECTED%' OR COLUMN_NAME ILIKE '%ETC%' OR COLUMN_NAME ILIKE '%COMPLETE%')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- Full column dumps for the three tables every later script depends on:
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM DB_CONTROL_TOWER.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'SCH_PROJECT_OPERATIONS'
  AND TABLE_NAME IN ('DT_COST_MANAGEMENT_BY_DAY', 'DT_PROJECTS', 'DT_PROJECTS_IN_SYSTEMS')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- ═══ Q2: Owner billing / SOV grain — where do billings-to-date live? ═════════
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM DB_CONTROL_TOWER.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'SCH_PROJECT_OPERATIONS'
  AND (TABLE_NAME ILIKE 'DT_WIP%' OR TABLE_NAME ILIKE 'DT_ACCOUNTS_RECEIVABLE%')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
-- Then eyeball grain: one row per project? per project-period? per draw line?
-- SELECT * FROM DT_WIP_DATA LIMIT 20;  -- [uncomment when running interactively]

-- ═══ Q3: Where do RFIs live — a PMWeb table, or ACC issues? ══════════════════
SELECT TABLE_NAME
FROM DB_CONTROL_TOWER.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'SCH_PROJECT_OPERATIONS'
  AND (TABLE_NAME ILIKE '%RFI%' OR TABLE_NAME ILIKE '%ISSUE%')
ORDER BY TABLE_NAME;
SELECT COLUMN_NAME, DATA_TYPE
FROM DB_CONTROL_TOWER.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'SCH_PROJECT_OPERATIONS' AND TABLE_NAME = 'DT_AUTODESK_ISSUES_CUSTOM_ATTRIBUTES'
ORDER BY ORDINAL_POSITION;

-- ═══ Q4: JDE fiscal calendar — calendar months or 4-4-5? ═════════════════════
-- LU_F0010_PERIODS is the JDE fiscal-period table (F0010).
SELECT * FROM LU_F0010_PERIODS LIMIT 30;   -- period end dates on month-ends ⇒ calendar

-- ═══ Q5: SmartPM % complete coverage across the pilot slate ══════════════════
SELECT COLUMN_NAME, DATA_TYPE
FROM DB_CONTROL_TOWER.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'SCH_PROJECT_OPERATIONS' AND TABLE_NAME = 'DT_SCHEDULE_HIT_SUMMARY_SMARTPM'
ORDER BY ORDINAL_POSITION;
-- Coverage once PILOT_PROJECTS is filled:
-- SELECT pp.PROJECT_NUMBER, s.* FROM SCH_CLAYOS_SEMANTIC.PILOT_PROJECTS pp
-- LEFT JOIN DT_SCHEDULE_HIT_SUMMARY_SMARTPM s ON <project key>   -- [INFERRED join — fix per dump above]
-- ;

-- ═══ Crosswalk shape (entity resolution spine) ════════════════════════════════
SELECT * FROM DT_PROJECTS_IN_SYSTEMS LIMIT 20;
SELECT COLUMN_NAME FROM DB_CONTROL_TOWER.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'SCH_PROJECT_OPERATIONS' AND TABLE_NAME = 'DT_PMWEB_SUBCONTRACTOR_FUZZY_MATCH'
ORDER BY ORDINAL_POSITION;
SELECT COLUMN_NAME FROM DB_CONTROL_TOWER.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'SCH_PROJECT_OPERATIONS' AND TABLE_NAME ILIKE 'LU_F0101%'
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- ═══ Broken/stale exclusions — assert they are STILL broken (or celebrate a fix) ═
WITH checks AS (
  SELECT 'DT_SUSTAINABILITY_UTILITY_ESTIMATES' t, (SELECT COUNT(*) FROM DT_SUSTAINABILITY_UTILITY_ESTIMATES) n
  UNION ALL SELECT 'LU_SPEC_CHANGE_EVENT_AT_RISK', (SELECT COUNT(*) FROM LU_SPEC_CHANGE_EVENT_AT_RISK)
  UNION ALL SELECT 'DT_SAFETY_FOCUS', (SELECT COUNT(*) FROM DT_SAFETY_FOCUS)
)
SELECT t AS object, n AS row_count,
       IFF(n = 0, 'still broken — keep excluded', 'HAS DATA NOW — revisit exclusion') AS verdict
FROM checks;

-- ═══ Freshness assertions on everything we DO consume ═════════════════════════
-- Dynamic-table refresh recency (data_timestamp) for the source tables of 02–04.
SELECT NAME, TARGET_LAG, SCHEDULING_STATE,
       TIMESTAMPDIFF('hour', DATA_TIMESTAMP, CURRENT_TIMESTAMP()) AS hours_since_data
FROM TABLE(INFORMATION_SCHEMA.DYNAMIC_TABLES())
WHERE NAME IN ('DT_PROJECTS','DT_PROJECTS_IN_SYSTEMS','DT_PARENT_PROJECTS',
               'DT_COST_MANAGEMENT_BY_DAY','DT_COST_MANAGEMENT','DT_CONTRACTS',
               'DT_LABOR_COST_AND_HOURS','DT_PMWEB_DAILY_REPORT_HOURS',
               'DT_SAFETY_INCIDENTS','DT_BIFSO','DT_TEXTURA_INVOICES','DT_WIP_DATA')
ORDER BY hours_since_data DESC;

-- ═══ Sensitive-isolation probe — this SHOULD FAIL with a permissions error ════
-- SELECT COUNT(*) FROM DT_PEOPLE_DATA;   -- expected: insufficient privileges (correct posture)

-- ═══ Cortex availability probe ════════════════════════════════════════════════
SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-3-5-sonnet', 'reply with the word: ok') AS cortex_probe;
-- Error ⇒ Cortex not enabled / model not available in region — record in README and
-- plan the agent host accordingly (external host with key-pair auth instead).
