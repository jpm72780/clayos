-- 03_entities_edges.sql — the ontology projection, ported from clayos migration 006.
-- Postgres used triggers into entities/edges; here each entity family is a SELECT in a
-- dynamic table (a better fit — no trigger ladder, Snowflake keeps it fresh).
--
-- Ids are natural keys, not UUIDs: ENTITY_ID = '<source>:<type>:<natural key>' so the
-- projection is deterministic and re-buildable (same property migration 006 got from
-- UNIQUE(source_table, source_id)).
--
-- Per plan: DailyLog/hours rows are NOT projected (kept relational for TRIR — avoids
-- ~100k junk nodes at 200 projects). Entity set for the pilot:
--   Project, Organization, Contract, CostAccount, RFI (or Issue — pending Q3),
--   SafetyEvent, PayApp, Pursuit
-- [INFERRED] columns throughout — verify against 01 before running. Role: CLAYOS_BUILDER.

USE ROLE CLAYOS_BUILDER;
USE WAREHOUSE WH_CLAYOS_XS;
USE SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC;

-- ═══ ENTITIES ═════════════════════════════════════════════════════════════════
CREATE OR REPLACE DYNAMIC TABLE ENTITIES
  TARGET_LAG = '1 day' WAREHOUSE = WH_CLAYOS_XS AS
-- Projects (spine: PROJECT_NUMBER via the DT_PROJECTS_IN_SYSTEMS crosswalk)
SELECT 'proj:' || p.PROJECT_NUMBER               AS ENTITY_ID,
       'Project'                                 AS ENTITY_TYPE,
       p.PROJECT_NAME                            AS LABEL,          -- [INFERRED]
       p.PROJECT_NUMBER                          AS PROJECT_NUMBER,
       pp.BUSINESS_UNIT                          AS BUSINESS_UNIT,
       OBJECT_CONSTRUCT('status', p.PROJECT_STATUS,                 -- [INFERRED]
                        'pmweb_id', p.PROJECT_ID) AS PROPERTIES     -- [INFERRED]
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_PROJECTS p
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = p.PROJECT_NUMBER      -- [INFERRED join col]
UNION ALL
-- Organizations (from the governed vendor master, 02)
SELECT vm.ORG_ID, 'Organization', vm.ORG_NAME, NULL, NULL,
       OBJECT_CONSTRUCT('org_type', vm.ORG_TYPE, 'address_number', vm.ADDRESS_NUMBER)
FROM VENDOR_MASTER vm
UNION ALL
-- Contracts / commitments
SELECT 'contract:' || c.CONTRACT_ID::TEXT,       -- [INFERRED] PMWeb surrogate id
       'Contract', c.CONTRACT_TITLE,             -- [INFERRED]
       c.PROJECT_NUMBER, pp.BUSINESS_UNIT,
       OBJECT_CONSTRUCT('value', c.CONTRACT_VALUE, 'status', c.CONTRACT_STATUS)  -- [INFERRED]
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_CONTRACTS c
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = c.PROJECT_NUMBER
UNION ALL
-- Cost accounts at cost-code grain (division rollup happens in the KPI layer, not here)
SELECT 'cost:' || cm.PROJECT_NUMBER || ':' || cm.COST_CODE_ID::TEXT,   -- [INFERRED]
       'CostAccount', cm.COST_CODE_DESCRIPTION,  -- [INFERRED]
       cm.PROJECT_NUMBER, pp.BUSINESS_UNIT,
       OBJECT_CONSTRUCT('bac', cm.CURRENT_BUDGET, 'committed', cm.COMMITTED)      -- [INFERRED]
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_COST_MANAGEMENT cm
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = cm.PROJECT_NUMBER
UNION ALL
-- RFIs  [PENDING Q3: swap to DT_AUTODESK_ISSUES if RFIs live in ACC]
SELECT 'rfi:' || r.RFI_ID::TEXT, 'RFI', r.SUBJECT,                    -- [INFERRED table + cols]
       r.PROJECT_NUMBER, pp.BUSINESS_UNIT,
       OBJECT_CONSTRUCT('status', r.STATUS, 'submitted', r.SUBMITTED_DATE, 'answered', r.ANSWERED_DATE)
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_RFIS r
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = r.PROJECT_NUMBER
UNION ALL
-- Safety incidents (no person identifiers — sensitive exclusion per plan)
SELECT 'safety:' || si.INCIDENT_ID::TEXT, 'SafetyEvent', si.INCIDENT_TYPE,       -- [INFERRED]
       si.PROJECT_NUMBER, pp.BUSINESS_UNIT,
       OBJECT_CONSTRUCT('recordable', si.IS_RECORDABLE, 'date', si.INCIDENT_DATE) -- [INFERRED]
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_SAFETY_INCIDENTS si
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = si.PROJECT_NUMBER
UNION ALL
-- Pay applications / draws  [PENDING Q2: source + grain]
SELECT 'payapp:' || w.PROJECT_NUMBER || ':' || w.PERIOD_END::TEXT, 'PayApp',      -- [INFERRED]
       'Draw ' || w.PERIOD_END::TEXT, w.PROJECT_NUMBER, pp.BUSINESS_UNIT,
       OBJECT_CONSTRUCT('billed_to_date', w.BILLED_TO_DATE)                        -- [INFERRED]
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_WIP_DATA w
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = w.PROJECT_NUMBER
UNION ALL
-- Pursuits (CRM) — no project link exists in the warehouse; the bridge is Phase-2 work
SELECT 'pursuit:' || o.OPPORTUNITY_ID::TEXT, 'Pursuit', o.OPPORTUNITY_NAME,       -- [INFERRED]
       NULL, NULL,
       OBJECT_CONSTRUCT('stage', o.STAGE, 'value', o.ESTIMATED_VALUE)             -- [INFERRED]
FROM DB_CONTROL_TOWER.SCH_SALES_AND_MARKETING_LTD.DT_OPPORTUNITY o;

-- ═══ EDGES ════════════════════════════════════════════════════════════════════
-- Same relation vocabulary as migration 006 where it applies.
CREATE OR REPLACE DYNAMIC TABLE EDGES
  TARGET_LAG = '1 day' WAREHOUSE = WH_CLAYOS_XS AS
-- project ─has_cost_account→ cost account
SELECT 'proj:' || cm.PROJECT_NUMBER            AS SRC,
       'cost:' || cm.PROJECT_NUMBER || ':' || cm.COST_CODE_ID::TEXT AS DST,
       'has_cost_account'                      AS RELATION
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_COST_MANAGEMENT cm
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = cm.PROJECT_NUMBER
UNION ALL
-- project ─has_contract→ contract
SELECT 'proj:' || c.PROJECT_NUMBER, 'contract:' || c.CONTRACT_ID::TEXT, 'has_contract'
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_CONTRACTS c
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = c.PROJECT_NUMBER
UNION ALL
-- contract ─contracted_to→ organization (through vendor resolution when key is PMWeb-side)
SELECT 'contract:' || c.CONTRACT_ID::TEXT,
       COALESCE('jde:' || c.SUPPLIER_NUMBER::TEXT, vr.ORG_ID),        -- [INFERRED] JDE direct, else resolved
       'contracted_to'
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_CONTRACTS c
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = c.PROJECT_NUMBER
LEFT JOIN VENDOR_RESOLUTION vr ON vr.SOURCE_SYSTEM = 'pmweb' AND vr.SOURCE_KEY = c.COMPANY_ID::TEXT  -- [INFERRED]
WHERE COALESCE(c.SUPPLIER_NUMBER::TEXT, vr.ORG_ID) IS NOT NULL
UNION ALL
-- project ─has_rfi→ rfi
SELECT 'proj:' || r.PROJECT_NUMBER, 'rfi:' || r.RFI_ID::TEXT, 'has_rfi'
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_RFIS r
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = r.PROJECT_NUMBER
UNION ALL
-- project ─has_safety_event→ safety incident
SELECT 'proj:' || si.PROJECT_NUMBER, 'safety:' || si.INCIDENT_ID::TEXT, 'has_safety_event'
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_SAFETY_INCIDENTS si
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = si.PROJECT_NUMBER
UNION ALL
-- project ─has_pay_app→ draw
SELECT 'proj:' || w.PROJECT_NUMBER, 'payapp:' || w.PROJECT_NUMBER || ':' || w.PERIOD_END::TEXT, 'has_pay_app'
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_WIP_DATA w
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = w.PROJECT_NUMBER;

-- Sanity queries after first build:
-- SELECT ENTITY_TYPE, COUNT(*) FROM ENTITIES GROUP BY 1 ORDER BY 2 DESC;
-- SELECT RELATION, COUNT(*) FROM EDGES GROUP BY 1 ORDER BY 2 DESC;
-- Orphan check (edge endpoints must exist):
-- SELECT COUNT(*) FROM EDGES e LEFT JOIN ENTITIES s ON s.ENTITY_ID = e.SRC
--   LEFT JOIN ENTITIES d ON d.ENTITY_ID = e.DST WHERE s.ENTITY_ID IS NULL OR d.ENTITY_ID IS NULL;
