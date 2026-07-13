# ClayOS semantic layer — Snowflake port (DB_CONTROL_TOWER)

Ports the proven ClayOS pattern (graph projection + KPI layer + guarded agent query) into Clayco's
real Snowflake warehouse. **No real data ever lands in the Supabase POC** — the semantic layer,
vectors, and agent queries all stay inside Snowflake. The Supabase app remains the synthetic demo
and reference implementation.

Plan of record: `/home/clawd/.claude/plans/db-control-tower-data-map-robust-comet.md`
(gap map, architecture rationale, phasing). Source-of-truth for the ported logic:
`migrations/006_triggers_projection.sql` (projection) and `migrations/007_kpi_views.sql` (KPI math).

## ⚠ Column names are INFERRED

These scripts were authored from a data-map assessment of DB_CONTROL_TOWER (row counts, table
names, key columns), **not** from live introspection. Every warehouse column that was not directly
observed is tagged `[INFERRED]`. The workflow is verification-first:

1. Run `01_source_verification.sql` — it introspects the real columns and answers the five
   mapping questions.
2. Adjust the `[INFERRED]` columns in `02`–`05` to match.
3. Only then create the semantic objects.

## Run order

| File | What it does | Needs |
|---|---|---|
| `00_setup.sql` | Roles, service user, XS warehouse + resource monitor, semantic schema, `PILOT_PROJECTS` config | SECURITYADMIN / SYSADMIN, schema-owner approval |
| `01_source_verification.sql` | Introspection + the 5 mapping questions + broken-object / freshness assertions | read on SCH_PROJECT_OPERATIONS |
| `02_vendor_master.sql` | Governed vendor crosswalk (JDE spine + fuzzy-match import + review queue) | 01 verified |
| `03_entities_edges.sql` | ENTITIES / EDGES dynamic tables (the ontology projection) | 02 |
| `04_kpi_views.sql` | KPI views: EVM with **three parallel EV bases**, safety TRIR, field, backlog, pipeline, BU rollup | 01 verified |
| `05_query_harness.sql` | Guarded read-only agent query path (port of `kg_query_safe`) | 00 |

## Prerequisites / governance (Phase 0 of the plan)

- **Approval from the DB_CONTROL_TOWER owner (CLYCO_DATAENGINEERS)** for a new schema. Default here
  is `DB_CONTROL_TOWER.SCH_CLAYOS_SEMANTIC`; if change control prefers a separate database, set the
  `DB` variable at the top of each script — nothing else changes.
- Confirm whether **Snowflake Cortex** is enabled on the account (Cortex Search replaces pgvector for
  entity semantic search; Cortex also offers Claude models in-platform so agent LLM calls need no
  data egress). `01` includes a probe.
- Key-pair credentials for the service user go wherever Clayco policy allows — **not** in the ClayOS
  POC secrets file.
- Pick the pilot slate (10–20 projects, 2 BUs with healthy PMWeb+JDE coverage) and insert the
  project numbers into `SCH_CLAYOS_SEMANTIC.PILOT_PROJECTS`. Every semantic object filters through
  it, so widening to all ~200 active projects later is an INSERT, not a rewrite.

## Design decisions carried from the plan

- **EV does not exist in the warehouse** (no cost-loaded schedule). `04` computes all three proxies
  side-by-side — `EV_CF` (cost-forecast basis, BAC×AC/EAC), `EV_SCHED` (SmartPM % complete × BAC),
  `EV_BILL` (billed-to-date) — each with its own CPI/SPI, plus a comparison view. Divergence between
  the bases is a first-class analytic, per John. None is presented as textbook EVM.
- **Vendor identity**: JDE address book is the canonical Organization spine; PMWeb attaches via the
  existing fuzzy-match table. ≥0.90 auto-link, 0.70–0.90 review queue, <0.70 stays separate.
  Deliberately under-merge.
- **DailyLog-grain rows are NOT projected as entities** (hours stay relational for TRIR); at 200
  projects that avoids ~100k junk nodes.
- **Never source** the broken/stale objects: `DT_SUSTAINABILITY_UTILITY_ESTIMATES` (0 rows),
  `LU_SPEC_CHANGE_EVENT_AT_RISK` (0 rows), `DT_SUBCONTRACTOR_DIVERSITY_GOALS` (stale),
  `TBL_DATES2`/`TBL_DATES_COPY`. `01` asserts this and checks freshness of everything we do consume.
- **Sensitive exclusions**: nothing reads `DT_PEOPLE_DATA` or any `_SENSITIVE` object; payroll only
  as project×day aggregates; safety facts carry no person identifiers.

## Verification (per plan)

- After `01`: the five mapping questions answered and recorded below in **Verified facts**.
- After `04`: per-project KPI reconciliation vs Tableau/source for every pilot project
  (`04` ends with a reconciliation query to export).
- After `05`: the harness rejects writes / multi-statement / out-of-schema reads (test block included).

## Verified facts (fill in after running 01)

| # | Question | Answer | Date |
|---|---|---|---|
| 1 | Forecast/EAC column in DT_COST_MANAGEMENT(_BY_DAY)? | _pending_ | |
| 2 | Owner billing / SOV grain (DT_WIP_DATA vs AR)? | _pending_ | |
| 3 | RFIs: PMWeb table or ACC issues? | _pending_ | |
| 4 | JDE fiscal calendar = calendar months? | _pending_ | |
| 5 | SmartPM % complete coverage across pilot slate? | _pending_ | |
