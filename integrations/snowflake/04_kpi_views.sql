-- 04_kpi_views.sql — KPI layer ported from clayos migration 007, adapted for the
-- warehouse's reality: EV and PV do not exist (no cost-loaded schedule), so EVM is
-- computed on THREE parallel EV bases (per John — divergence is a first-class analytic):
--
--   EV_CF    = BAC × (AC / EAC_forecast)     "cost-forecast basis" — CPI_CF = BAC/EAC:
--                                            budget vs forecast-at-completion (default lens)
--   EV_SCHED = BAC × SmartPM % complete      "schedule basis" — project grain, coarse
--   EV_BILL  = billed-to-date                "billing basis" — never the default CPI; it
--                                            forces WIP over/under-billing to ~0 by construction
--   PV_LIN   = BAC × linear time elapsed     shared PV proxy for the SPI analogues, from
--                                            planned start/finish dates (label as derived)
--
-- Formula reference preserved from migration 007:
--   CPI = EV/AC   SPI = EV/PV   TRIR = recordables × 200,000 / hours   backlog = CV − earned
-- [INFERRED] columns throughout — verify against 01. Role: CLAYOS_BUILDER.

USE ROLE CLAYOS_BUILDER;
USE WAREHOUSE WH_CLAYOS_XS;
USE SCHEMA DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC;

-- ═══ Cost position per project (month-end snapshot from the 98M-row daily table) ═
-- Snowflake does the heavy lifting; consumers only ever see pilot × month-end rows.
CREATE OR REPLACE VIEW COST_POSITION_MONTHLY AS
SELECT cbd.PROJECT_NUMBER,                                      -- [INFERRED]
       cbd.AS_OF_DATE,
       SUM(cbd.CURRENT_BUDGET)  AS BAC,                         -- [INFERRED] Q1 confirms names
       SUM(cbd.ACTUAL_COST)     AS AC,                          -- [INFERRED]
       SUM(cbd.COMMITTED)       AS COMMITTED,                   -- [INFERRED]
       SUM(cbd.FORECAST_AT_COMPLETION) AS EAC                   -- [INFERRED] ← Q1's whole point
FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_COST_MANAGEMENT_BY_DAY cbd
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = cbd.PROJECT_NUMBER
WHERE cbd.AS_OF_DATE = LAST_DAY(cbd.AS_OF_DATE)                 -- month-ends only
   OR cbd.AS_OF_DATE = (SELECT MAX(AS_OF_DATE)
                        FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_COST_MANAGEMENT_BY_DAY)
GROUP BY cbd.PROJECT_NUMBER, cbd.AS_OF_DATE;

-- ═══ KPI_EVM — three EV bases side by side, latest position per project ═══════
CREATE OR REPLACE VIEW KPI_EVM AS
WITH latest AS (
  SELECT * FROM COST_POSITION_MONTHLY
  QUALIFY ROW_NUMBER() OVER (PARTITION BY PROJECT_NUMBER ORDER BY AS_OF_DATE DESC) = 1
),
sched AS (  -- SmartPM project-level % complete  [PENDING Q5: column + coverage]
  SELECT s.PROJECT_NUMBER, s.PCT_COMPLETE / 100.0 AS SCHED_PCT   -- [INFERRED]
  FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_SCHEDULE_HIT_SUMMARY_SMARTPM s
),
bill AS (   -- billed to date  [PENDING Q2: source + grain]
  SELECT w.PROJECT_NUMBER, MAX(w.BILLED_TO_DATE) AS BILLED_TO_DATE   -- [INFERRED]
  FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_WIP_DATA w
  GROUP BY w.PROJECT_NUMBER
),
dates AS (  -- planned start/finish for the linear PV proxy
  SELECT p.PROJECT_NUMBER, p.PLANNED_START_DATE, p.PLANNED_FINISH_DATE, p.CONTRACT_VALUE  -- [INFERRED]
  FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_PROJECTS p
)
SELECT
  l.PROJECT_NUMBER,
  pp.BUSINESS_UNIT,
  l.AS_OF_DATE,
  l.BAC, l.AC, l.COMMITTED, l.EAC,
  d.CONTRACT_VALUE,
  -- the three EV bases
  IFF(l.EAC > 0, l.BAC * l.AC / l.EAC, NULL)                        AS EV_CF,
  IFF(s.SCHED_PCT IS NOT NULL, l.BAC * s.SCHED_PCT, NULL)           AS EV_SCHED,
  b.BILLED_TO_DATE                                                  AS EV_BILL,
  -- shared linear PV proxy (derived — label it everywhere)
  IFF(d.PLANNED_FINISH_DATE > d.PLANNED_START_DATE,
      l.BAC * LEAST(1, GREATEST(0,
        DATEDIFF('day', d.PLANNED_START_DATE, l.AS_OF_DATE)::FLOAT
        / NULLIF(DATEDIFF('day', d.PLANNED_START_DATE, d.PLANNED_FINISH_DATE), 0))), NULL) AS PV_LIN,
  -- CPI per basis
  IFF(l.AC > 0 AND l.EAC > 0,            ROUND(l.BAC * l.AC / l.EAC / l.AC, 3), NULL)  AS CPI_CF,   -- = BAC/EAC
  IFF(l.AC > 0 AND s.SCHED_PCT IS NOT NULL, ROUND(l.BAC * s.SCHED_PCT / l.AC, 3), NULL) AS CPI_SCHED,
  IFF(l.AC > 0 AND b.BILLED_TO_DATE IS NOT NULL, ROUND(b.BILLED_TO_DATE / l.AC, 3), NULL) AS CPI_BILL,
  -- SPI analogues against the linear PV proxy
  IFF(PV_LIN > 0 AND EV_CF    IS NOT NULL, ROUND(EV_CF / PV_LIN, 3), NULL)    AS SPI_CF,
  IFF(PV_LIN > 0 AND EV_SCHED IS NOT NULL, ROUND(EV_SCHED / PV_LIN, 3), NULL) AS SPI_SCHED,
  -- % complete per basis
  IFF(l.BAC > 0, ROUND(l.AC / NULLIF(l.EAC, 0), 3), NULL)           AS PCT_COMPLETE_CF,
  s.SCHED_PCT                                                       AS PCT_COMPLETE_SCHED,
  'derived: EV/PV proxies — not cost-loaded-schedule EVM'           AS PROVENANCE
FROM latest l
JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = l.PROJECT_NUMBER
LEFT JOIN sched s ON s.PROJECT_NUMBER = l.PROJECT_NUMBER
LEFT JOIN bill  b ON b.PROJECT_NUMBER = l.PROJECT_NUMBER
LEFT JOIN dates d ON d.PROJECT_NUMBER = l.PROJECT_NUMBER;

-- ═══ KPI_EV_BASIS_COMPARE — the divergence analytic (John's ask) ══════════════
-- Big spread between bases is itself the finding:
--   EV_BILL >> EV_CF  → billing ahead of cost progress (overbilled / front-loaded SOV)
--   EV_CF  >> EV_SCHED → cost forecast optimistic vs schedule reality (or SmartPM stale)
CREATE OR REPLACE VIEW KPI_EV_BASIS_COMPARE AS
SELECT PROJECT_NUMBER, BUSINESS_UNIT, AS_OF_DATE, BAC,
       EV_CF, EV_SCHED, EV_BILL,
       ROUND(EV_BILL  - EV_CF, 2)    AS BILL_MINUS_CF,
       ROUND(EV_CF    - EV_SCHED, 2) AS CF_MINUS_SCHED,
       ROUND(GREATEST(COALESCE(EV_CF,0), COALESCE(EV_SCHED,0), COALESCE(EV_BILL,0))
           - LEAST(COALESCE(EV_CF,1e15), COALESCE(EV_SCHED,1e15), COALESCE(EV_BILL,1e15)), 2) AS MAX_SPREAD
FROM KPI_EVM;

-- ═══ KPI_SAFETY — real TRIR (port of kpi_safety; hours stay relational) ═══════
CREATE OR REPLACE VIEW KPI_SAFETY AS
WITH hrs AS (  -- project × day aggregate; no person identifiers
  SELECT lh.PROJECT_NUMBER, SUM(lh.HOURS_WORKED) AS HOURS_WORKED    -- [INFERRED]
  FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_LABOR_COST_AND_HOURS lh
  JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = lh.PROJECT_NUMBER
  GROUP BY lh.PROJECT_NUMBER
),
ev AS (
  SELECT si.PROJECT_NUMBER,
         COUNT_IF(si.IS_RECORDABLE) AS RECORDABLES,                 -- [INFERRED]
         COUNT_IF(si.IS_LOST_TIME)  AS LOST_TIME_CASES,             -- [INFERRED]
         COUNT(*)                   AS TOTAL_EVENTS
  FROM DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_SAFETY_INCIDENTS si
  JOIN PILOT_PROJECTS pp ON pp.PROJECT_NUMBER = si.PROJECT_NUMBER
  GROUP BY si.PROJECT_NUMBER
)
SELECT pp.PROJECT_NUMBER, pp.BUSINESS_UNIT,
       COALESCE(h.HOURS_WORKED, 0) AS HOURS_WORKED,
       COALESCE(e.RECORDABLES, 0)  AS RECORDABLES,
       COALESCE(e.LOST_TIME_CASES, 0) AS LOST_TIME_CASES,
       IFF(COALESCE(h.HOURS_WORKED,0) > 0, ROUND(COALESCE(e.RECORDABLES,0) * 200000.0 / h.HOURS_WORKED, 2), NULL) AS TRIR,
       IFF(COALESCE(h.HOURS_WORKED,0) > 0, ROUND(COALESCE(e.LOST_TIME_CASES,0) * 200000.0 / h.HOURS_WORKED, 2), NULL) AS DART
FROM PILOT_PROJECTS pp
LEFT JOIN hrs h ON h.PROJECT_NUMBER = pp.PROJECT_NUMBER
LEFT JOIN ev  e ON e.PROJECT_NUMBER = pp.PROJECT_NUMBER;

-- ═══ KPI_FIELD — RFI turnaround (port of kpi_field)  [PENDING Q3 source] ══════
CREATE OR REPLACE VIEW KPI_FIELD AS
SELECT pp.PROJECT_NUMBER, pp.BUSINESS_UNIT,
       COUNT_IF(r.STATUS = 'Open')  AS OPEN_RFIS,                   -- [INFERRED]
       COUNT(r.RFI_ID)              AS TOTAL_RFIS,
       ROUND(AVG(IFF(r.ANSWERED_DATE IS NOT NULL,
                     DATEDIFF('day', r.SUBMITTED_DATE, r.ANSWERED_DATE), NULL)), 1) AS AVG_RFI_TURNAROUND_DAYS
FROM PILOT_PROJECTS pp
LEFT JOIN DB_CONTROL_TOWER.SCH_PROJECT_OPERATIONS.DT_RFIS r
       ON r.PROJECT_NUMBER = pp.PROJECT_NUMBER
GROUP BY pp.PROJECT_NUMBER, pp.BUSINESS_UNIT;

-- ═══ KPI_BACKLOG / KPI_BU_ROLLUP (ports of kpi_backlog / kg_bu_rollup) ════════
CREATE OR REPLACE VIEW KPI_BACKLOG AS
SELECT e.BUSINESS_UNIT,
       SUM(e.CONTRACT_VALUE)                          AS CONTRACT_VALUE_ACTIVE,
       SUM(e.CONTRACT_VALUE * COALESCE(e.PCT_COMPLETE_CF, 0)) AS EARNED_TO_DATE,   -- CF basis
       SUM(e.CONTRACT_VALUE * (1 - COALESCE(e.PCT_COMPLETE_CF, 0))) AS BACKLOG
FROM KPI_EVM e
GROUP BY e.BUSINESS_UNIT;

CREATE OR REPLACE VIEW KPI_PIPELINE AS
SELECT o.STAGE,                                                     -- [INFERRED]
       COUNT(*) AS PURSUITS,
       SUM(o.ESTIMATED_VALUE) AS PIPELINE_VALUE,                    -- [INFERRED]
       SUM(o.ESTIMATED_VALUE * COALESCE(o.WIN_PROBABILITY, 0) / 100) AS WEIGHTED_VALUE  -- [INFERRED]
FROM DB_CONTROL_TOWER.SCH_SALES_AND_MARKETING_LTD.DT_OPPORTUNITY o
GROUP BY o.STAGE;

CREATE OR REPLACE VIEW KPI_BU_ROLLUP AS
SELECT e.BUSINESS_UNIT,
       COUNT(*)                             AS PROJECTS,
       SUM(e.CONTRACT_VALUE)                AS TOTAL_CONTRACT_VALUE,
       SUM(e.BAC)                           AS TOTAL_BAC,
       SUM(e.AC)                            AS TOTAL_AC,
       IFF(SUM(e.EAC) > 0, ROUND(SUM(e.BAC) / SUM(e.EAC), 3), NULL) AS CPI_CF,   -- value-weighted
       SUM(s.RECORDABLES)                   AS RECORDABLES,
       SUM(s.HOURS_WORKED)                  AS HOURS_WORKED,
       IFF(SUM(s.HOURS_WORKED) > 0, ROUND(SUM(s.RECORDABLES) * 200000.0 / SUM(s.HOURS_WORKED), 2), NULL) AS TRIR,
       SUM(f.OPEN_RFIS)                     AS OPEN_RFIS
FROM KPI_EVM e
LEFT JOIN KPI_SAFETY s ON s.PROJECT_NUMBER = e.PROJECT_NUMBER
LEFT JOIN KPI_FIELD  f ON f.PROJECT_NUMBER = e.PROJECT_NUMBER
GROUP BY e.BUSINESS_UNIT;

-- ═══ Reconciliation export (plan exit criterion for Phase 1) ══════════════════
-- Hand-verify every pilot project against Tableau/source before anyone sees these numbers.
CREATE OR REPLACE VIEW KPI_RECONCILIATION AS
SELECT e.PROJECT_NUMBER, e.AS_OF_DATE, e.BAC, e.AC, e.EAC, e.CONTRACT_VALUE,
       e.CPI_CF, e.CPI_SCHED, e.CPI_BILL, s.TRIR, f.OPEN_RFIS, f.TOTAL_RFIS,
       NULL AS TABLEAU_BAC, NULL AS TABLEAU_AC, NULL AS TABLEAU_EAC, NULL AS TABLEAU_TRIR,  -- fill by hand
       NULL AS VERIFIED_BY, NULL AS VERIFIED_AT
FROM KPI_EVM e
LEFT JOIN KPI_SAFETY s ON s.PROJECT_NUMBER = e.PROJECT_NUMBER
LEFT JOIN KPI_FIELD  f ON f.PROJECT_NUMBER = e.PROJECT_NUMBER;
