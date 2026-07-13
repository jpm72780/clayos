-- 00_setup.sql — roles, service user, warehouse, semantic schema, pilot config.
-- Run as: SECURITYADMIN (roles/user) + SYSADMIN (warehouse/schema), or ACCOUNTADMIN.
-- Requires prior approval from the DB_CONTROL_TOWER owner (CLYCO_DATAENGINEERS) for the schema.
--
-- If change control prefers a separate database, change DB below — everything else is relative.

SET DB = 'DB_CONTROL_TOWER';
SET RAW_SCHEMA = $DB || '.SCH_PROJECT_OPERATIONS';
SET SALES_SCHEMA = $DB || '.SCH_SALES_AND_MARKETING_LTD';
SET SEM_SCHEMA = $DB || '.SCH_CLAYOS_SEMANTIC';

-- ═══ Roles ════════════════════════════════════════════════════════════════════
-- CLAYOS_BUILDER : owns + builds the semantic schema; reads the raw schemas.
-- CLAYOS_AGENT   : the agent's runtime role — SELECT on the SEMANTIC schema ONLY.
--                  Structurally cannot see raw tables or anything _SENSITIVE.
USE ROLE SECURITYADMIN;
CREATE ROLE IF NOT EXISTS CLAYOS_BUILDER;
CREATE ROLE IF NOT EXISTS CLAYOS_AGENT;
GRANT ROLE CLAYOS_BUILDER TO ROLE SYSADMIN;
GRANT ROLE CLAYOS_AGENT   TO ROLE CLAYOS_BUILDER;

-- ═══ Warehouse (dedicated, tiny, self-suspending) ════════════════════════════
USE ROLE SYSADMIN;
CREATE WAREHOUSE IF NOT EXISTS WH_CLAYOS_XS
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  STATEMENT_TIMEOUT_IN_SECONDS = 60          -- hard cap for anything on this warehouse
  COMMENT = 'ClayOS semantic layer + agent queries. Keep XS; monitor before resizing.';

USE ROLE ACCOUNTADMIN;  -- resource monitors require it
CREATE RESOURCE MONITOR IF NOT EXISTS RM_CLAYOS
  WITH CREDIT_QUOTA = 20 FREQUENCY = MONTHLY START_TIMESTAMP = IMMEDIATELY
  TRIGGERS ON 75 PERCENT DO NOTIFY
           ON 100 PERCENT DO SUSPEND;
ALTER WAREHOUSE WH_CLAYOS_XS SET RESOURCE_MONITOR = RM_CLAYOS;

-- ═══ Service user (key-pair only — no password) ══════════════════════════════
-- Generate the key pair per Snowflake docs; paste the public key here.
-- Store the private key per Clayco policy (NOT in the ClayOS POC secrets file).
USE ROLE SECURITYADMIN;
CREATE USER IF NOT EXISTS CLAYOS_SVC
  DEFAULT_ROLE = CLAYOS_BUILDER
  DEFAULT_WAREHOUSE = WH_CLAYOS_XS
  RSA_PUBLIC_KEY = '<PASTE_PUBLIC_KEY>'      -- [FILL IN]
  COMMENT = 'ClayOS semantic-layer service user. Key-pair auth only.';
GRANT ROLE CLAYOS_BUILDER TO USER CLAYOS_SVC;

-- Optional but recommended: pin to known egress IPs once the runtime host is decided.
-- CREATE NETWORK POLICY NP_CLAYOS ALLOWED_IP_LIST = ('<runtime-ip>/32');
-- ALTER USER CLAYOS_SVC SET NETWORK_POLICY = NP_CLAYOS;

-- ═══ Grants: read raw operations data (minus sensitive), own the semantic schema ═
USE ROLE SYSADMIN;
GRANT USAGE ON DATABASE IDENTIFIER($DB) TO ROLE CLAYOS_BUILDER;
GRANT USAGE ON SCHEMA IDENTIFIER($RAW_SCHEMA)   TO ROLE CLAYOS_BUILDER;
GRANT USAGE ON SCHEMA IDENTIFIER($SALES_SCHEMA) TO ROLE CLAYOS_BUILDER;
GRANT SELECT ON ALL TABLES        IN SCHEMA IDENTIFIER($RAW_SCHEMA) TO ROLE CLAYOS_BUILDER;
GRANT SELECT ON ALL DYNAMIC TABLES IN SCHEMA IDENTIFIER($RAW_SCHEMA) TO ROLE CLAYOS_BUILDER;
GRANT SELECT ON ALL VIEWS         IN SCHEMA IDENTIFIER($RAW_SCHEMA) TO ROLE CLAYOS_BUILDER;
GRANT SELECT ON ALL TABLES        IN SCHEMA IDENTIFIER($SALES_SCHEMA) TO ROLE CLAYOS_BUILDER;
GRANT SELECT ON ALL DYNAMIC TABLES IN SCHEMA IDENTIFIER($SALES_SCHEMA) TO ROLE CLAYOS_BUILDER;
-- NOTE: DT_PEOPLE_DATA is owned by CLYCO_DATAENGINEERS_SENSITIVE and is NOT granted here.
-- Verify in 01 that CLAYOS_BUILDER genuinely cannot read it (a failing probe = correct).

GRANT USAGE ON WAREHOUSE WH_CLAYOS_XS TO ROLE CLAYOS_BUILDER;
GRANT USAGE ON WAREHOUSE WH_CLAYOS_XS TO ROLE CLAYOS_AGENT;

-- Semantic schema, owned by the builder role.
CREATE SCHEMA IF NOT EXISTS IDENTIFIER($SEM_SCHEMA)
  COMMENT = 'ClayOS semantic layer: ontology projection (ENTITIES/EDGES), KPI views, vendor master.';
GRANT OWNERSHIP ON SCHEMA IDENTIFIER($SEM_SCHEMA) TO ROLE CLAYOS_BUILDER COPY CURRENT GRANTS;

-- Agent role sees ONLY the semantic schema (grants finalized in 05 after objects exist).
GRANT USAGE ON DATABASE IDENTIFIER($DB) TO ROLE CLAYOS_AGENT;
GRANT USAGE ON SCHEMA IDENTIFIER($SEM_SCHEMA) TO ROLE CLAYOS_AGENT;

-- ═══ Pilot configuration ══════════════════════════════════════════════════════
-- Every semantic object filters through this table. Widening to all ~200 active
-- projects later = INSERT more rows; nothing else changes.
USE ROLE CLAYOS_BUILDER;
USE SCHEMA IDENTIFIER($SEM_SCHEMA);

CREATE TABLE IF NOT EXISTS PILOT_PROJECTS (
  PROJECT_NUMBER  TEXT PRIMARY KEY,     -- canonical natural key (JDE project number)
  BUSINESS_UNIT   TEXT,                 -- pilot BU label (for rollups until real BU mapping lands)
  ADDED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  NOTE            TEXT
);
-- INSERT INTO PILOT_PROJECTS (PROJECT_NUMBER, BUSINESS_UNIT, NOTE) VALUES
--   ('<proj#>', '<BU>', 'pilot wave 1');   -- [FILL IN — John picks the 10–20 project slate]

-- Run log: every load/refresh/validation writes a row (mirrors clayos integration_runs concept).
CREATE TABLE IF NOT EXISTS INTEGRATION_RUNS (
  RUN_ID     TEXT DEFAULT UUID_STRING(),
  RUN_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  STEP       TEXT,                      -- '01_verify' | '02_vendor' | ...
  STATUS     TEXT,                      -- 'ok' | 'warn' | 'fail'
  DETAIL     VARIANT
);
