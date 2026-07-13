-- 02_vendor_master.sql — governed vendor/organization crosswalk.
-- JDE address book (F0101) = the canonical Organization spine (financial system of record).
-- PMWeb companies attach as aliases via the existing fuzzy-match table with thresholds:
--   score ≥ 0.90         → auto-link
--   0.70 ≤ score < 0.90  → VENDOR_MATCH_REVIEW queue (human decision)
--   score < 0.70         → stays a separate (PMWeb-only) org
-- Deliberately under-merges: two rows for one vendor is an annoyance; one row for two
-- vendors silently corrupts every vendor rollup.
--
-- [INFERRED] columns throughout — verify against the 01 column dumps before running.
-- Role: CLAYOS_BUILDER.

USE ROLE CLAYOS_BUILDER;
USE WAREHOUSE WH_CLAYOS_XS;
USE SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC;

-- Scope guard: only orgs touching pilot projects (a few hundred rows, not the whole address book).
-- Contracts/commitments are the linking facts.
CREATE OR REPLACE DYNAMIC TABLE PILOT_VENDOR_KEYS
  TARGET_LAG = '1 day' WAREHOUSE = WH_CLAYOS_XS AS
SELECT DISTINCT c.SUPPLIER_NUMBER            -- [INFERRED] JDE supplier key on contracts/commitments
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_CONTRACTS c   -- [INFERRED] table carries JDE keys
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = c.PROJECT_NUMBER -- [INFERRED]
WHERE c.SUPPLIER_NUMBER IS NOT NULL;

-- ═══ Canonical spine: one row per JDE address-book org in pilot scope ═════════
CREATE OR REPLACE DYNAMIC TABLE VENDOR_MASTER
  TARGET_LAG = '1 day' WAREHOUSE = WH_CLAYOS_XS AS
SELECT
  'jde:' || ab.ADDRESS_NUMBER::TEXT              AS ORG_ID,        -- stable natural id
  ab.ADDRESS_NUMBER,                                               -- [INFERRED] F0101 key
  ab.ALPHA_NAME                                  AS ORG_NAME,      -- [INFERRED] F0101 name col
  ab.SEARCH_TYPE                                 AS ORG_TYPE,      -- [INFERRED] JDE search type (V=vendor, C=customer…)
  -- normalized name used for any residual matching (strip suffixes/punct, collapse space)
  TRIM(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(ab.ALPHA_NAME),
       '\\b(LLC|L\\.L\\.C\\.|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP)\\b\\.?', ''),
       '[^A-Z0-9 ]|\\s+', ' '))                  AS NAME_NORM
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.LU_F0101_ADDRESS_BOOK ab  -- [INFERRED] exact LU_F0101_* name from 01
WHERE ab.ADDRESS_NUMBER IN (SELECT SUPPLIER_NUMBER FROM PILOT_VENDOR_KEYS);

-- ═══ Aliases: PMWeb companies linked to the spine via the fuzzy-match table ═══
CREATE OR REPLACE DYNAMIC TABLE VENDOR_ALIAS
  TARGET_LAG = '1 day' WAREHOUSE = WH_CLAYOS_XS AS
SELECT
  'jde:' || fm.SUPPLIER_NUMBER::TEXT             AS ORG_ID,        -- [INFERRED] fuzzy-match JDE side
  'pmweb'                                        AS SOURCE_SYSTEM,
  fm.COMPANY_ID::TEXT                            AS SOURCE_KEY,    -- [INFERRED] fuzzy-match PMWeb side
  fm.COMPANY_NAME                                AS SOURCE_NAME,   -- [INFERRED]
  fm.MATCH_SCORE                                 AS CONFIDENCE,    -- [INFERRED] score column name
  'auto (score >= 0.90)'                         AS LINK_BASIS
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_PMWEB_SUBCONTRACTOR_FUZZY_MATCH fm
WHERE fm.MATCH_SCORE >= 0.90
  AND fm.SUPPLIER_NUMBER IN (SELECT SUPPLIER_NUMBER FROM PILOT_VENDOR_KEYS);

-- ═══ Review queue: mid-band matches needing a human decision ══════════════════
CREATE OR REPLACE DYNAMIC TABLE VENDOR_MATCH_REVIEW
  TARGET_LAG = '1 day' WAREHOUSE = WH_CLAYOS_XS AS
SELECT fm.SUPPLIER_NUMBER, fm.COMPANY_ID, fm.COMPANY_NAME, fm.MATCH_SCORE   -- [INFERRED]
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_PMWEB_SUBCONTRACTOR_FUZZY_MATCH fm
WHERE fm.MATCH_SCORE >= 0.70 AND fm.MATCH_SCORE < 0.90
  AND fm.SUPPLIER_NUMBER IN (SELECT SUPPLIER_NUMBER FROM PILOT_VENDOR_KEYS);

-- Approved manual links land here (plain table; survives dynamic-table rebuilds).
CREATE TABLE IF NOT EXISTS VENDOR_ALIAS_MANUAL (
  ORG_ID        TEXT,           -- 'jde:<address_number>'
  SOURCE_SYSTEM TEXT,           -- 'pmweb' | 'textura' | 'tradetapp'
  SOURCE_KEY    TEXT,
  DECIDED_BY    TEXT,
  DECIDED_AT    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (SOURCE_SYSTEM, SOURCE_KEY)
);

-- Unified resolution view the projection (03) consumes.
CREATE OR REPLACE VIEW VENDOR_RESOLUTION AS
SELECT ORG_ID, SOURCE_SYSTEM, SOURCE_KEY, CONFIDENCE, LINK_BASIS FROM VENDOR_ALIAS
UNION ALL
SELECT ORG_ID, SOURCE_SYSTEM, SOURCE_KEY, 1.0, 'manual' FROM VENDOR_ALIAS_MANUAL;

-- Validation: review queue should be small for the pilot slate (plan target: < ~50 rows).
-- SELECT COUNT(*) FROM VENDOR_MATCH_REVIEW;
