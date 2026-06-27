-- Migration 007: KPI materialized views (the reporting/metrics layer).
--
-- Construction KPIs computed from the per-domain tables and rolled up by business
-- unit (ltree). Materialized (not on-demand) so dashboards + the agent's kg_kpi
-- tool read instant, stable aggregates. Refreshed by refresh_all_kpis() (009 cron).
--
-- Formula references (pinned for correctness; validate against seed known-good):
--   SPI = EV/PV   CPI = EV/AC   SV = EV-PV   CV = EV-AC   EAC = BAC*AC/EV
--   pct_complete = EV/BAC
--   earned_revenue = contract_value * pct_complete
--   over/under billing = billings_to_date - earned_revenue   (>0 = overbilled)
--   TRIR = recordables * 200,000 / hours_worked     DART = lost_time * 200,000 / hours
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

-- ═══ EVM (per project) ═══════════════════════════════════════════════════════
DROP MATERIALIZED VIEW IF EXISTS clayos.kpi_evm CASCADE;
CREATE MATERIALIZED VIEW clayos.kpi_evm AS
WITH latest AS (   -- latest cumulative measurement per cost account
  SELECT cp.cost_account_id,
         (array_agg(cp.pv ORDER BY cp.period DESC))[1] AS pv,
         (array_agg(cp.ev ORDER BY cp.period DESC))[1] AS ev,
         (array_agg(cp.ac ORDER BY cp.period DESC))[1] AS ac
  FROM clayos.cost_progress cp
  GROUP BY cp.cost_account_id
),
acct AS (
  SELECT ca.project_id, ca.bac,
         COALESCE(l.pv,0) AS pv, COALESCE(l.ev,0) AS ev, COALESCE(l.ac,0) AS ac
  FROM clayos.cost_accounts ca
  LEFT JOIN latest l ON l.cost_account_id = ca.id
)
SELECT p.id AS project_id, p.business_unit_id, p.name AS project_name, p.lifecycle_stage,
       SUM(a.bac) AS bac, SUM(a.pv) AS pv, SUM(a.ev) AS ev, SUM(a.ac) AS ac,
       (SUM(a.ev) - SUM(a.pv)) AS sv,
       (SUM(a.ev) - SUM(a.ac)) AS cv,
       CASE WHEN SUM(a.pv) > 0 THEN round(SUM(a.ev) / SUM(a.pv), 3) END AS spi,
       CASE WHEN SUM(a.ac) > 0 THEN round(SUM(a.ev) / SUM(a.ac), 3) END AS cpi,
       CASE WHEN SUM(a.ev) > 0 THEN round(SUM(a.bac) * SUM(a.ac) / SUM(a.ev), 2) END AS eac,
       CASE WHEN SUM(a.bac) > 0 THEN round(SUM(a.ev) / SUM(a.bac), 3) END AS pct_complete
FROM clayos.projects p
JOIN acct a ON a.project_id = p.id
GROUP BY p.id, p.business_unit_id, p.name, p.lifecycle_stage;
CREATE UNIQUE INDEX kpi_evm_pk ON clayos.kpi_evm (project_id);

-- ═══ WIP / billing (per project) ═════════════════════════════════════════════
DROP MATERIALIZED VIEW IF EXISTS clayos.kpi_wip CASCADE;
CREATE MATERIALIZED VIEW clayos.kpi_wip AS
WITH latest_app AS (
  SELECT DISTINCT ON (pa.project_id) pa.project_id, pa.id AS pay_app_id
  FROM clayos.pay_apps pa
  ORDER BY pa.project_id, pa.number DESC
),
billed AS (
  SELECT la.project_id,
         SUM(pl.work_completed_to_date + pl.materials_stored) AS billings_to_date,
         SUM(pl.retainage_amount) AS retainage_held
  FROM latest_app la
  JOIN clayos.pay_app_lines pl ON pl.pay_app_id = la.pay_app_id
  GROUP BY la.project_id
)
SELECT p.id AS project_id, p.business_unit_id, p.name AS project_name,
       p.contract_value,
       COALESCE(e.pct_complete, 0) AS pct_complete,
       round(p.contract_value * COALESCE(e.pct_complete, 0), 2) AS earned_revenue,
       COALESCE(b.billings_to_date, 0) AS billings_to_date,
       COALESCE(b.retainage_held, 0) AS retainage_held,
       round(COALESCE(b.billings_to_date, 0) - p.contract_value * COALESCE(e.pct_complete, 0), 2) AS over_under_billing
FROM clayos.projects p
LEFT JOIN clayos.kpi_evm e ON e.project_id = p.id
LEFT JOIN billed b ON b.project_id = p.id
WHERE p.contract_value IS NOT NULL;
CREATE UNIQUE INDEX kpi_wip_pk ON clayos.kpi_wip (project_id);

-- ═══ Safety (per project) ════════════════════════════════════════════════════
DROP MATERIALIZED VIEW IF EXISTS clayos.kpi_safety CASCADE;
CREATE MATERIALIZED VIEW clayos.kpi_safety AS
WITH hrs AS (
  SELECT project_id, SUM(manpower_count) * 8 AS hours_worked
  FROM clayos.daily_logs GROUP BY project_id
),
ev AS (
  SELECT project_id,
         COUNT(*) FILTER (WHERE recordable)          AS recordables,
         COUNT(*) FILTER (WHERE lost_time)           AS lost_time_cases,
         COUNT(*) FILTER (WHERE type = 'near_miss')  AS near_misses,
         COUNT(*)                                    AS total_events
  FROM clayos.safety_events GROUP BY project_id
)
SELECT p.id AS project_id, p.business_unit_id, p.name AS project_name,
       COALESCE(h.hours_worked, 0) AS hours_worked,
       COALESCE(e.recordables, 0) AS recordables,
       COALESCE(e.lost_time_cases, 0) AS lost_time_cases,
       COALESCE(e.near_misses, 0) AS near_misses,
       COALESCE(e.total_events, 0) AS total_events,
       CASE WHEN COALESCE(h.hours_worked,0) > 0 THEN round(COALESCE(e.recordables,0) * 200000.0 / h.hours_worked, 2) END AS trir,
       CASE WHEN COALESCE(h.hours_worked,0) > 0 THEN round(COALESCE(e.lost_time_cases,0) * 200000.0 / h.hours_worked, 2) END AS dart
FROM clayos.projects p
LEFT JOIN hrs h ON h.project_id = p.id
LEFT JOIN ev  e ON e.project_id = p.id;
CREATE UNIQUE INDEX kpi_safety_pk ON clayos.kpi_safety (project_id);

-- ═══ Field (per project) ═════════════════════════════════════════════════════
DROP MATERIALIZED VIEW IF EXISTS clayos.kpi_field CASCADE;
CREATE MATERIALIZED VIEW clayos.kpi_field AS
SELECT p.id AS project_id, p.business_unit_id, p.name AS project_name,
       COUNT(r.id) FILTER (WHERE r.status = 'open') AS open_rfis,
       COUNT(r.id) AS total_rfis,
       round(AVG((r.answered_date - r.submitted_date)) FILTER (WHERE r.answered_date IS NOT NULL), 1) AS avg_rfi_turnaround_days,
       (SELECT COUNT(*) FROM clayos.submittals s WHERE s.project_id = p.id AND s.status IN ('submitted','under_review')) AS open_submittals
FROM clayos.projects p
LEFT JOIN clayos.rfis r ON r.project_id = p.id
GROUP BY p.id, p.business_unit_id, p.name;
CREATE UNIQUE INDEX kpi_field_pk ON clayos.kpi_field (project_id);

-- ═══ Pipeline / BD (per business unit) ═══════════════════════════════════════
DROP MATERIALIZED VIEW IF EXISTS clayos.kpi_pipeline CASCADE;
CREATE MATERIALIZED VIEW clayos.kpi_pipeline AS
SELECT bu.id AS business_unit_id, bu.name AS business_unit_name,
       COUNT(pu.id) AS pursuits,
       COUNT(pu.id) FILTER (WHERE pu.stage = 'won')  AS won,
       COUNT(pu.id) FILTER (WHERE pu.stage = 'lost') AS lost,
       COALESCE(SUM(pu.est_value) FILTER (WHERE pu.stage NOT IN ('won','lost')), 0) AS open_pipeline_value,
       COALESCE(SUM(pu.est_value * COALESCE(pu.win_probability,0)/100) FILTER (WHERE pu.stage NOT IN ('won','lost')), 0) AS weighted_pipeline_value,
       CASE WHEN COUNT(pu.id) FILTER (WHERE pu.stage IN ('won','lost')) > 0
            THEN round(COUNT(pu.id) FILTER (WHERE pu.stage = 'won')::numeric
                       / COUNT(pu.id) FILTER (WHERE pu.stage IN ('won','lost')), 3) END AS win_rate
FROM clayos.business_units bu
LEFT JOIN clayos.pursuits pu ON pu.business_unit_id = bu.id
GROUP BY bu.id, bu.name;
CREATE UNIQUE INDEX kpi_pipeline_pk ON clayos.kpi_pipeline (business_unit_id);

-- ═══ Backlog (per business unit) ═════════════════════════════════════════════
DROP MATERIALIZED VIEW IF EXISTS clayos.kpi_backlog CASCADE;
CREATE MATERIALIZED VIEW clayos.kpi_backlog AS
SELECT p.business_unit_id,
       SUM(p.contract_value) AS contract_value_active,
       SUM(COALESCE(w.earned_revenue, 0)) AS earned_to_date,
       SUM(p.contract_value - COALESCE(w.earned_revenue, 0)) AS backlog
FROM clayos.projects p
LEFT JOIN clayos.kpi_wip w ON w.project_id = p.id
WHERE p.status = 'active' AND p.contract_value IS NOT NULL
GROUP BY p.business_unit_id;
CREATE UNIQUE INDEX kpi_backlog_pk ON clayos.kpi_backlog (business_unit_id);

-- ═══ Resource utilization (per business unit) ════════════════════════════════
DROP MATERIALIZED VIEW IF EXISTS clayos.kpi_resource_util CASCADE;
CREATE MATERIALIZED VIEW clayos.kpi_resource_util AS
WITH per_person AS (
  SELECT pe.id, pe.business_unit_id, COALESCE(SUM(sa.allocation_pct), 0) AS alloc
  FROM clayos.persons pe
  LEFT JOIN clayos.staffing_assignments sa ON sa.person_id = pe.id
  WHERE pe.is_active
  GROUP BY pe.id, pe.business_unit_id
)
SELECT business_unit_id,
       COUNT(*) AS people,
       round(AVG(alloc), 1) AS avg_utilization_pct,
       COUNT(*) FILTER (WHERE alloc = 0)   AS unstaffed,
       COUNT(*) FILTER (WHERE alloc > 100) AS overallocated
FROM per_person
WHERE business_unit_id IS NOT NULL
GROUP BY business_unit_id;
CREATE UNIQUE INDEX kpi_resource_util_pk ON clayos.kpi_resource_util (business_unit_id);

-- ═══ Business-unit rollup (executive view; ltree-aggregated incl. descendants) ═
DROP MATERIALIZED VIEW IF EXISTS clayos.kg_bu_rollup CASCADE;
CREATE MATERIALIZED VIEW clayos.kg_bu_rollup AS
SELECT bu.id AS business_unit_id, bu.name AS business_unit_name, bu.kind,
       COUNT(p.id) AS projects,
       COUNT(p.id) FILTER (WHERE p.status = 'active') AS active_projects,
       COALESCE(SUM(p.contract_value), 0) AS total_contract_value,
       COALESCE(SUM(ev.bac), 0) AS total_bac,
       COALESCE(SUM(ev.ev), 0)  AS total_ev,
       COALESCE(SUM(ev.ac), 0)  AS total_ac,
       CASE WHEN SUM(ev.pv) > 0 THEN round(SUM(ev.ev) / SUM(ev.pv), 3) END AS spi,
       CASE WHEN SUM(ev.ac) > 0 THEN round(SUM(ev.ev) / SUM(ev.ac), 3) END AS cpi,
       COALESCE(SUM(sf.recordables), 0) AS recordables,
       COALESCE(SUM(sf.hours_worked), 0) AS hours_worked,
       CASE WHEN SUM(sf.hours_worked) > 0 THEN round(SUM(sf.recordables) * 200000.0 / SUM(sf.hours_worked), 2) END AS trir,
       COALESCE(SUM(fld.open_rfis), 0) AS open_rfis
FROM clayos.business_units bu
LEFT JOIN clayos.projects p
       ON p.business_unit_id IN (SELECT d.id FROM clayos.business_units d WHERE d.path <@ bu.path)
LEFT JOIN clayos.kpi_evm    ev  ON ev.project_id  = p.id
LEFT JOIN clayos.kpi_safety sf  ON sf.project_id  = p.id
LEFT JOIN clayos.kpi_field  fld ON fld.project_id = p.id
GROUP BY bu.id, bu.name, bu.kind;
CREATE UNIQUE INDEX kg_bu_rollup_pk ON clayos.kg_bu_rollup (business_unit_id);

-- ═══ History (nightly snapshots for trend charts) ════════════════════════════
CREATE TABLE IF NOT EXISTS clayos.kpi_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date    date NOT NULL,
  business_unit_id uuid,
  project_id       uuid,
  metric           text NOT NULL,
  value            numeric,
  UNIQUE (snapshot_date, business_unit_id, project_id, metric)
);

CREATE OR REPLACE FUNCTION clayos.snapshot_kpis()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO clayos.kpi_history (snapshot_date, business_unit_id, project_id, metric, value)
  SELECT CURRENT_DATE, business_unit_id, project_id, m.metric, m.value
  FROM clayos.kpi_evm e,
       LATERAL (VALUES ('spi', e.spi), ('cpi', e.cpi), ('pct_complete', e.pct_complete)) AS m(metric, value)
  WHERE m.value IS NOT NULL
  ON CONFLICT (snapshot_date, business_unit_id, project_id, metric) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO clayos.kpi_history (snapshot_date, business_unit_id, project_id, metric, value)
  SELECT CURRENT_DATE, business_unit_id, project_id, 'trir', trir
  FROM clayos.kpi_safety WHERE trir IS NOT NULL
  ON CONFLICT (snapshot_date, business_unit_id, project_id, metric) DO UPDATE SET value = EXCLUDED.value;
END $$;

-- ═══ Refresh-all (correct dependency order) ══════════════════════════════════
CREATE OR REPLACE FUNCTION clayos.refresh_all_kpis()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW clayos.kpi_evm;
  REFRESH MATERIALIZED VIEW clayos.kpi_safety;
  REFRESH MATERIALIZED VIEW clayos.kpi_field;
  REFRESH MATERIALIZED VIEW clayos.kpi_wip;            -- depends on kpi_evm
  REFRESH MATERIALIZED VIEW clayos.kpi_pipeline;
  REFRESH MATERIALIZED VIEW clayos.kpi_backlog;        -- depends on kpi_wip
  REFRESH MATERIALIZED VIEW clayos.kpi_resource_util;
  REFRESH MATERIALIZED VIEW clayos.kg_bu_rollup;       -- depends on kpi_evm/safety/field
END $$;

-- ═══ Convenience: all KPIs for one project (agent kg_kpi / dashboard) ════════
-- Accepts EITHER a domain project id (projects.id, used by the dashboard) or a
-- Project entity id (entities.id, what the agent gets from kg_search/traverse).
CREATE OR REPLACE FUNCTION clayos.kg_project_kpis(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE pid uuid;
BEGIN
  SELECT COALESCE(
    (SELECT source_id FROM clayos.entities WHERE id = p_project AND source_table = 'projects'),
    p_project) INTO pid;
  RETURN jsonb_build_object(
    'evm',    (SELECT to_jsonb(e) FROM clayos.kpi_evm    e WHERE e.project_id = pid),
    'wip',    (SELECT to_jsonb(w) FROM clayos.kpi_wip    w WHERE w.project_id = pid),
    'safety', (SELECT to_jsonb(s) FROM clayos.kpi_safety s WHERE s.project_id = pid),
    'field',  (SELECT to_jsonb(f) FROM clayos.kpi_field  f WHERE f.project_id = pid)
  );
END $$;

-- Grants (matviews are covered by ALL TABLES, but be explicit).
GRANT SELECT ON clayos.kpi_evm, clayos.kpi_wip, clayos.kpi_safety, clayos.kpi_field,
                clayos.kpi_pipeline, clayos.kpi_backlog, clayos.kpi_resource_util,
                clayos.kg_bu_rollup, clayos.kpi_history TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.refresh_all_kpis()        TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.snapshot_kpis()           TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.kg_project_kpis(uuid)     TO PUBLIC;
