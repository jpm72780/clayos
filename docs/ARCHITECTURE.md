# ClayOS — Architecture Reference

> **Living document.** Stable design reference. Update when the architecture changes
> (not every session). Source of truth for the schema so migrations can be regenerated.

**Canonical plan:** `/home/clawd/.claude/plans/lets-create-a-new-breezy-curry.md`

## The five layers (roadmap order)

1. **Ontology viewer / knowledge graph** — all company data, project + non-project, start→finish.
2. **Reporting layer** — quantifies all data, organized by business unit.
3. **KPI / metrics layer** — EVM (SPI/CPI), WIP, backlog, safety TRIR, utilization.
4. **Agentic layer** — any user asks natural-language questions against the data.
5. **App / workflow builder** (roadmap) — scoped/controlled data access for tools.

## Stack & infra mapping

| Layer | Tech | Where |
|---|---|---|
| L0 Data/Ontology | Postgres (`clayos` schema), numbered SQL migrations | Supabase + local pgvector |
| L1 Semantic | `entities.embedding` pgvector/HNSW + async embed queue | Supabase + `embed-entities` fn |
| L2 Query/API | `kg_*` RPCs, KPI matviews, PostgREST, `clayos_readonly` role | Supabase |
| L3 Agentic | Claude 32-turn tool-use loop | Supabase Edge Function `agent-ask` |
| L4 Reporting/KPI | matviews refreshed by `pg_cron`; Recharts | Supabase + frontend |
| L5 App builder | `app_definitions`/`app_scopes`/`app_tools` (stubs) | Supabase; n8n later |

**Frontend:** React 19 + Vite + Tailwind → Cloudflare Pages (GitHub Actions `wrangler pages deploy`).

## Graph model — the core decision

- **Per-domain relational tables = system of record.** KPIs query these directly.
- **`entities` + `edges` = denormalized projection**, consumed ONLY by the viewer + agent
  traversal. Never authoritative; rebuilt by `kg_reproject_all()`.
- **Strict hierarchies** (business_units, wbs_nodes, classification_codes) → `ltree`.
- **Cross-domain mesh** (RFI→element→document→org) → `edges`.
- **Sync:** AFTER INSERT/UPDATE/DELETE triggers call `project_to_graph(table, id)`; embeddings
  async via `graph_embed_jobs`; nightly `pg_cron` runs `kg_reproject_all()` + KPI refresh.

See `docs/DECISIONS.md` ADR-001 (Postgres not Neo4j), ADR-002 (projection model).

## Migrations (numbered, forward-only)

| # | File | Status | Contents |
|---|---|---|---|
| 001 | extensions | ✅ applied | schema, ltree/vector/pg_trgm, `set_updated_at()`, `maintain_path()` |
| 002 | classification | ✅ applied | `classification_systems`/`classification_codes` (ltree) + seed systems |
| 003 | business_units | ✅ applied | `business_units` (ltree, kind) |
| 004 | domain_tables | ✅ applied | 35 per-domain tables (spec below) |
| 005 | graph | ✅ applied | `entities`, `edges`, `kg_traverse`/`kg_subgraph`/`kg_neighbors`/`kg_search` RPCs |
| 006 | triggers_projection | ✅ applied | `project_entity`/`project_edges`/`project_to_graph`, triggers, `graph_embed_jobs`, `kg_reproject_all()` |
| 007 | kpi_views | ✅ applied | EVM/WIP/safety/field/backlog/util matviews, `kg_bu_rollup`, `refresh_all_kpis()`, `kpi_history`, `kg_project_kpis` |
| 008 | rls | ✅ applied | grants, `clayos_readonly` role (full RLS scoping = Phase 2) |
| 009 | cron | ✅ applied | pg_cron schedules (guarded; no-op locally) |

**Verified on local PG (2026-06-27):** all 9 apply clean; seed loads 750 entities / 1004 edges;
KPI known-good numbers confirmed (see PROGRESS_LOG).

### Convention for hierarchical tables
Any tree table has `(id uuid, parent_id uuid, path ltree, depth int)` and attaches a
`BEFORE INSERT OR UPDATE OF parent_id` trigger running `clayos.maintain_path()`. Path labels are
the row's hex UUID (dashes stripped). Applies to `business_units`, `classification_codes`, `wbs_nodes`.

## Domain tables (spec for migration 004)

Grouped by lifecycle domain. Each row notes the graph `entity_type` and `domain` it projects to
(tables marked *relational only* are NOT nodes — they project to edges or feed KPIs).

**Enterprise master data**
- `organizations` → `Organization` / `enterprise`. cols: name, org_type(client|owner|gc|subcontractor|supplier|architect|engineer|developer|authority), trade, city, state.
- `persons` → `Person` / `hr`. cols: business_unit_id, full_name, email, title, role_category, hire_date, hourly_rate, is_active.

**Project core**
- `projects` → `Project` / `project`. cols: business_unit_id, code(uniq), name, sector, lifecycle_stage(pursuit|precon|design|construction|closeout|warranty|complete), status, contract_value, owner_org_id, gc_org_id, architect_org_id, developer_org_id, city, state, gross_sf, start_date, end_date, actual_finish, description.
- `phases` → `Phase` / `project_controls`. cols: project_id, name, seq, start_date, end_date, status.
- `wbs_nodes` → `Work` / `project_controls`. **ltree tree.** cols: project_id, parent_id, code, name, code_id→classification_codes, path, depth.

**Design / BIM**
- `spaces` → `Space` / `design`. cols: project_id, building, level, name, space_type, area_sf.
- `building_elements` → `BuildingElement` / `design`. cols: project_id, space_id, uniformat_code_id, ifc_class, name, manufacturer, model, status(design|procured|installed|commissioned).
- `documents` → `Document` / `design`. cols: project_id, doc_type(drawing|specification|rfi|submittal|report|model|contract|manual), number, revision, title, discipline, status, author_person_id, issued_date.

**Project controls — cost (EVM)**
- `cost_accounts` → `CostAccount` / `project_controls`. cols: project_id, wbs_node_id, masterformat_code_id, name, cost_type(labor|material|equipment|subcontract|overhead), bac, committed.
- `cost_progress` *relational only* (feeds EVM). cols: cost_account_id, period(date month-end), pv, ev, ac (all cumulative). UNIQUE(cost_account_id, period).

**Project controls — schedule**
- `schedule_activities` → `Activity` / `project_controls`. cols: project_id, wbs_node_id, activity_code, name, planned_start, planned_finish, actual_start, actual_finish, pct_complete, is_critical, total_float_days.
- `schedule_dependencies` *relational only* (→ `depends_on` edges). cols: predecessor_id, successor_id, dep_type(FS|SS|FF|SF), lag_days.

**Field operations**
- `rfis` → `RFI` / `field_ops`. cols: project_id, number, subject, body, discipline, spec_section_code_id, status(open|answered|closed|void), ball_in_court(GC|Architect|Owner|Sub|Engineer), submitted_date, due_date, answered_date, cost_impact, schedule_impact_days, building_element_id, created_by_person_id.
- `submittals` → `Submittal` / `field_ops`. cols: project_id, number, title, spec_section_code_id, status(draft|submitted|under_review|approved|approved_as_noted|revise_resubmit|rejected), submitted_date, returned_date, ball_in_court.
- `daily_logs` → `DailyLog` / `field_ops`. cols: project_id, log_date, weather, temp_high, temp_low, manpower_count (×8h ≈ labor hours → TRIR denominator), work_performed, delays, author_person_id.

**Safety / EHS**
- `safety_events` → `SafetyEvent` / `safety`. cols: project_id, event_date, type(near_miss|first_aid|recordable|lost_time|property_damage|observation), severity, recordable, lost_time, description, corrective_action, person_id, location.

**Quality / QA-QC**
- `quality_events` → `QualityEvent` / `quality`. cols: project_id, type(inspection|nonconformance|punch_item|test), status(open|closed|passed|failed), building_element_id, wbs_node_id, description, severity, identified_date, resolved_date.

**Financials / billing (AIA G702/G703)**
- `pay_apps` → `PayApp` / `financials`. cols: project_id, number, period_end, status(draft|submitted|approved|paid), submitted_date, approved_date. UNIQUE(project_id, number).
- `pay_app_lines` *relational only* (feeds WIP). cols: pay_app_id, cost_account_id, description, scheduled_value, work_completed_this_period, work_completed_to_date, materials_stored, retainage_pct, retainage_amount.

**Business development / estimating**
- `pursuits` → `Pursuit` / `business_development`. cols: business_unit_id, name, client_org_id, sector, stage(identified|qualified|proposal|shortlisted|won|lost), est_value, win_probability, go_decision, identified_date, decision_date.
- `estimates` → `Estimate` / `estimating`. cols: project_id, pursuit_id, version, estimate_type(conceptual|schematic|dd|gmp), total_value, status(draft|submitted|awarded|lost).

**Procurement / buyout**
- `contracts` → `Contract` / `procurement`. cols: project_id, org_id, contract_type(prime|subcontract|purchase_order|change_order), masterformat_code_id, value, executed_date, status, scope.

**Service groups (non-project)**
- `requisitions` → `Requisition` / `recruiting`. cols: business_unit_id, title, department, status(open|interviewing|offer|filled|closed), opened_date, filled_date, hiring_manager_person_id, location.
- `staffing_assignments` *relational only* (→ `staffed_on` edges person→project). cols: person_id, project_id, role_on_project, allocation_pct, start_date, end_date.
- `it_assets` → `ITAsset` / `it`. cols: asset_tag, asset_type(laptop|workstation|tablet|phone|server|license), assigned_person_id, business_unit_id, status(in_use|available|retired|repair), purchase_date.

**App/workflow builder (stubs)**
- `app_definitions` (slug, name, description, system_prompt), `app_scopes` (app_id, entity_type, business_unit_id, domain, access read|write), `app_tools` (app_id, tool).

## Graph projection — entity & edge types (migration 005/006)

`entities (id, entity_type, business_unit_id, source_table, source_id UNIQUE, label,
classification_id, domain, properties jsonb, embedding vector(1536), updated_at)` —
indexes: entity_type, business_unit_id, domain, GIN(properties), partial HNSW(embedding).

`edges (id, edge_type, src_id→entities, dst_id→entities, weight, properties jsonb)` —
UNIQUE(edge_type, src_id, dst_id); indexes (src_id, edge_type), (dst_id, edge_type).

**Edge types to emit** (src → dst):
- `in_business_unit` — Project/Person/Pursuit/Requisition → business_unit (modeled as entity? No:
  business units are filter dimensions via `entities.business_unit_id`, not nodes. Optional to also
  node-ify; default: keep BU as a column, not a node.)
- `has_phase` Project→Phase · `has_work`/`part_of` WBS parent↔child & Project→WBS
- `has_activity` Project→Activity · `depends_on` Activity→Activity (from schedule_dependencies)
- `has_cost_account` Project→CostAccount · `costs_for` CostAccount→WBS
- `contains_space` Project→Space · `located_in` BuildingElement→Space
- `specified_by` BuildingElement→Document · `documents` Document→Project
- `pertains_to` RFI→BuildingElement · `about_spec` RFI/Submittal→classification (optional)
- `has_rfi`/`has_submittal`/`has_daily_log`/`has_safety_event`/`has_quality_event`/`has_pay_app` Project→*
- `staffed_on` Person→Project (from staffing_assignments) · `employed_by` Person→Organization? (persons
  are Clayco employees; map to BU instead)
- `client_for` Organization→Project (owner_org) · `architect_for`/`gc_for`/`developer_for` Org→Project
- `subcontract_on` Contract→Organization, Contract→Project
- `pursuing` Pursuit→Organization(client) · `won_as` Pursuit→Project (if converted)

**Projection idempotency:** `project_entity(table,id)` upserts the entity by (source_table,source_id);
`project_edges(table,id)` deletes that entity's outgoing edges then re-inserts (linking only to
entities that already exist). `kg_reproject_all()` does pass-1 all entities, pass-2 all edges so the
graph is complete regardless of seed insert order.

## KPI views (migration 007)

Materialized views, refreshed by `pg_cron` (and `refresh_all_kpis()`):
- `kpi_evm` — per project (+ optionally per WBS): BAC, PV/EV/AC (latest cost_progress period),
  `SPI=EV/PV`, `CPI=EV/AC`, `SV=EV-PV`, `CV=EV-AC`, `EAC=BAC/CPI`, budget variance. **One project
  seeded deliberately behind/over → CPI<1, SPI<1.**
- `kpi_wip` — contract_value, pct_complete (EV/BAC), earned_revenue = contract_value×pct,
  billings_to_date (Σ pay_app_lines.work_completed_to_date latest app), over/under-billing,
  retainage held.
- `kpi_safety` — recordables, lost_time, hours_worked (Σ daily_logs.manpower_count×8),
  `TRIR=recordables×200000/hours`, DART.
- `kpi_field` — open RFIs, avg RFI turnaround days, open submittals.
- `kpi_backlog` / `kpi_pipeline` — signed backlog by BU; pursuit pipeline value + conversion.
- `kpi_resource_util` — person allocation vs capacity.
- `kpi_bu_rollup` — every metric aggregated by `business_units.path` (ltree rollup) for the exec view.
- `kpi_history` (table) — nightly snapshot for trend charts/sparklines.

Pin EVM/WIP formulas in migration comments; validate against the seed's known-good numbers.

## Agentic layer (migration n/a — Edge Function)

`agent-ask` = fork of counterpart `agent-step-claude` (32-turn loop). Read-only tool registry
`kg_*` (in `supabase/functions/_shared/kg_tools.ts`):
`kg_search` (HNSW semantic) · `kg_get_entity` (node + real domain record + neighbors) ·
`kg_traverse` (N-hop) · `kg_kpi` (structured metric lookup — golden path) ·
`kg_query` (constrained single-SELECT text-to-SQL escape hatch) · `kg_schema` · `kg_classification`.
Safety: `clayos_readonly` role, single-SELECT validation + statement_timeout + LIMIT, RLS scoping,
per-turn world-state snapshot, answers cite entity/record IDs. Prefer `kg_kpi` over free SQL.
Verify current Claude model IDs/params via the **claude-api skill** before wiring.

## Reuse map (from `/home/clawd/projects/counterpart`)

| Copy/adapt | From |
|---|---|
| 32-turn Claude tool loop → `agent-ask` | `supabase/functions/agent-step-claude/index.ts` (loop at L649-794) |
| tool registry + dispatch + ctx scoping → `kg_tools.ts` | `supabase/functions/_shared/cp_tools.ts` (`CpContext` L855, `executeCpTool` L2388) |
| embeddings adapter (≈verbatim; simplify creds) | `supabase/functions/_shared/embeddings.ts` |
| per-turn world-state injection | `supabase/functions/_shared/global_context.ts` |
| ltree path trigger pattern | `migrations/006_node_model.sql` (`maintain_node_path` L59) |
| pgvector + partial-HNSW + async embed queue + ANN RPC | `migrations/064_memories.sql` |
| matview + pg_cron refresh | `migrations/089*`, `095*` |
| React Flow curated views + Sparkline | `dashboard/src/components/OrgChart.jsx`, `Sparkline.jsx` |
| Cloudflare Pages deploy workflow | `.github/workflows/` |

Build new: all domain DDL, entities/edges + projection, KPI matviews, `kg_*` tool bodies,
Sigma ontology viewer, Recharts dashboards, seed generator.
