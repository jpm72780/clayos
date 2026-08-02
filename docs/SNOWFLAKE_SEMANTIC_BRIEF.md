# ClayOS — System Architecture & the Snowflake Semantic Layer Contract

**Purpose.** One document that answers two questions: (1) exactly how the ClayOS proof-of-concept
is built, layer by layer, and (2) everything the Snowflake team needs to consider when building
the semantic views layer over `DB_CONTROL_TOWER` so the same tool can run on Clayco's real data.

**Audience.** Clayco data engineering / IT, plus anyone evaluating the port.
**Status.** POC live at https://clayos.pages.dev (synthetic data only). Snowflake scripts authored
and waiting on Phase-0 governance (`integrations/snowflake/` in the repo).
**Governing constraint.** Supabase is not Clayco-approved: **no real Clayco data ever lands in the
POC**. The port moves the *pattern* into Snowflake — the data never moves out.

---

## Part 1 — How ClayOS is built

### 1.1 The idea: five layers over one graph

ClayOS is a "company operating system" — a single interface over everything a design-build firm
knows about itself. It is built as five layers, each consuming the one below:

1. **Ontology / knowledge graph** — every project, person, vendor, cost account, RFI, safety
   event… as typed nodes and relationships.
2. **Reporting** — the same data quantified and organized by business unit.
3. **KPI / metrics** — EVM (CPI/SPI/EAC), WIP billing position, backlog, pipeline, safety TRIR,
   workforce utilization, with history for trends.
4. **Agentic Q&A** — natural-language questions answered by an LLM that can only reach the data
   through guarded, read-only tools, with cited numbers.
5. **App/workflow builder** — (roadmap) scoped data access for purpose-built mini-apps.

The core architectural decision (ADR-001): **the knowledge graph is Postgres-native — no graph
database.** Per-domain relational tables are the system of record; a generic `entities`/`edges`
projection is derived from them and consumed only by the viewer and the agent. KPIs never read
the graph; they read the relational tables. This is what makes the pattern portable to Snowflake:
it is all just SQL over tables.

### 1.2 Stack at a glance

| Layer | Technology | Where it runs |
|---|---|---|
| System of record | Postgres (`clayos` schema), 14 forward-only SQL migrations | Supabase (micro) |
| Graph projection | `entities` / `edges` tables + trigger-driven projection | Supabase |
| Semantic search | pgvector `vector(1536)` + partial HNSW index, async embed queue | Supabase + `embed-entities` edge fn |
| KPI layer | 8 materialized views + ltree BU rollup + `kpi_history`, refreshed by pg_cron | Supabase |
| API | PostgREST (REST over tables/views) + `kg_*` SQL functions (RPCs) | Supabase |
| Agent | `agent-ask` edge function — Claude (`claude-opus-4-8`), ≤24 tool turns, SSE streaming | Supabase Edge Functions |
| Frontend | React 19 + Vite + Tailwind; three.js 3D, d3-geo map, Sigma network, Recharts | Cloudflare Pages (static) |

Synthetic dataset at time of writing: **200 projects · 6,345 entities · 8,561 edges · 47 cities ·
~$29B contract value**, generated deterministically by `seed/generate.py` (one SQL transaction;
re-seed is one idempotent script).

### 1.3 Layer 0 — the relational system of record

Thirty-five domain tables grouped by lifecycle domain (migration 004). The ones that matter for
the port:

- **Enterprise master** — `organizations` (clients, subs, architects…, with `org_type`/trade),
  `persons`, `business_units` (ltree hierarchy with a `kind` discriminator).
- **Project core** — `projects` (code, sector, `lifecycle_stage`, status, contract_value, owner /
  gc / architect / developer org FKs, city/state, gross SF, dates), `phases`, `wbs_nodes`
  (ltree tree, classification-coded).
- **Cost (EVM)** — `cost_accounts` (BAC, committed, MasterFormat-coded, cost_type) and
  `cost_progress` (**monthly cumulative PV / EV / AC per cost account** — the sole EVM feed).
- **Schedule** — `schedule_activities` + `schedule_dependencies` (CPM-style, FS/SS/FF/SF + lag).
- **Field ops** — `rfis` (status, ball-in-court, dates, cost/schedule impact), `submittals`,
  `daily_logs` (manpower_count × 8h ⇒ labor hours ⇒ the TRIR denominator).
- **Safety / quality** — `safety_events` (type, recordable, lost_time), `quality_events`.
- **Financials** — `pay_apps` + `pay_app_lines` (AIA G702/G703 shape: scheduled value, work
  completed to date, stored materials, retainage) — the WIP feed.
- **BD / estimating / procurement** — `pursuits` (stage, est_value, win_probability),
  `estimates`, `contracts` (prime/sub/PO/CO, MasterFormat-coded).
- **Service groups & people ops** — `service_groups` (17 groups as a system-of-record table),
  `staffing_assignments` (person→project allocation %), `requisitions`, `it_assets`.
- **Classification** — `classification_systems` / `classification_codes` (MasterFormat,
  UniFormat, OmniClass as ltree trees) — the cross-cutting "highlight by CSI code / vendor /
  person" feature reads these.

Conventions worth keeping in any port: every hierarchy table carries `(parent_id, path, depth)`
maintained by one shared trigger; every table has `updated_at` maintained by another; migrations
are numbered and forward-only.

### 1.4 Layer 1 — the knowledge-graph projection

Two generic tables:

```
entities (id uuid, entity_type, business_unit_id, source_table, source_id,  -- UNIQUE(source_table, source_id)
          label, classification_id, domain, properties jsonb,
          embedding vector(1536), updated_at)
edges    (id, edge_type, src_id → entities, dst_id → entities, weight, properties)
          -- UNIQUE(edge_type, src_id, dst_id)
```

- **22 entity types** (Project, Phase, Work, Activity, CostAccount, PayApp, Contract, RFI,
  Submittal, DailyLog, QualityEvent, SafetyEvent, Space, BuildingElement, Document, Person,
  Organization, ServiceGroup, Pursuit, Estimate, Requisition, ITAsset) across 14 lifecycle
  domains. ~25 edge types (`has_rfi`, `staffed_on`, `contracted_to`, `depends_on`, `client_for`,
  `services`, `shares_data_with`, …).
- **Sync** — AFTER INSERT/UPDATE/DELETE triggers on every domain table call
  `project_to_graph(table, id)`, which upserts the entity (idempotent on
  `(source_table, source_id)`) and re-derives its edges. Embeddings are decoupled: the upsert
  enqueues into `graph_embed_jobs`; an edge function drains the queue asynchronously.
- **Rebuildability** — `kg_reproject_all()` truncates and rebuilds the whole graph in three
  passes (entities → edges → service-group projection), landing on identical counts. The graph is
  cattle, not a pet — this property is what the Snowflake dynamic-table design preserves.
- **Graph API** — SQL functions consumed by both UI and agent: `kg_subgraph` (filtered node/edge
  payload for the viewers), `kg_traverse` (N-hop), `kg_neighbors`, `kg_search` (HNSW semantic),
  `kg_entity_facts` (per-entity "last real activity date + dollar amount" — drives the 3D flow
  animation and $-weighted vessels), `kg_project_kpis`, `kg_bu_rollup`.

### 1.5 Layer 2 — KPIs and reporting

Eight materialized views (migration 007), refreshed every 30 minutes by pg_cron, snapshotted
nightly into `kpi_history` (04:20 UTC) for trend charts. Formulas are pinned in migration
comments and validated against seeded known-good numbers:

| View | Definition |
|---|---|
| `kpi_evm` | per project: BAC, latest cumulative PV/EV/AC, **SPI = EV/PV**, **CPI = EV/AC**, SV, CV, **EAC = BAC/CPI** |
| `kpi_wip` | earned revenue (contract × % complete) vs billings-to-date → **over/under-billing**, retainage held |
| `kpi_safety` | recordables, lost-time, hours (Σ daily-log manpower × 8), **TRIR = recordables × 200,000 / hours**, DART |
| `kpi_field` | open RFIs, average RFI turnaround days, open submittals |
| `kpi_backlog` | signed contract value not yet earned, by BU |
| `kpi_pipeline` | pursuit value × win probability, by BU |
| `kpi_resource_util` | allocation vs capacity, bench, overallocated |
| `kg_bu_rollup` | every metric rolled up the `business_units` ltree for the exec view |

Portfolio-level numbers in the UI are **value-weighted** (CPI weighted by BAC, TRIR weighted by
hours) — never naive averages.

### 1.6 Layer 3 — the agent

`agent-ask` (Supabase edge function): Claude `claude-opus-4-8`, up to 24 tool-use turns, 4096
max tokens, streaming SSE to the UI (tool-progress events + token deltas + a structured `done`
payload). Both a JSON path (used by the regression evals) and the SSE path share one loop.

**Seven read-only tools** (`_shared/kg_tools.ts`):

| Tool | Role |
|---|---|
| `kg_kpi` | **the golden path** — structured KPI lookup by project or BU; the prompt instructs the model to always prefer this for numeric questions |
| `kg_search` | semantic entity search (pgvector HNSW), scopeable by BU/domain |
| `kg_get_entity` | one entity + its real underlying domain record + neighbors |
| `kg_traverse` | N-hop graph walk (≤3), filterable by edge type |
| `kg_classification` | resolve MasterFormat/UniFormat codes |
| `kg_schema` | self-describe the schema (called before free SQL) |
| `kg_query` | the escape hatch — free-form **single SELECT** text-to-SQL |

**The `kg_query` safety harness** (migration 011) is the piece to study for the port. Defense in
depth: (1) the function executes as a dedicated `clayos_readonly` role — even a validation bypass
has no write grants and no reach outside the `clayos` schema; (2) validation rejects
multi-statement input and any non-SELECT/DDL/DML keyword; (3) `statement_timeout = 5s` and a
500-row cap. Verified by tests that writes, multi-statements, and `auth.*` reads all reject.

Two behaviors that make the agent feel native to the tool: answers **cite the records** they used,
and the model emits a structured `@@VIEW project=…@@` hint that the server normalizes
(name → project code) so the UI can fly the 3D scene or map to whatever the answer is about. A
six-question golden eval set (`evals/run.mjs`) runs against live cloud after every agent change.

### 1.7 Layer 4 — the frontend

React 19 SPA, statically hosted, every view a lazy chunk. One shared selection model unifies it:
a `focus` (project) and a cross-cutting `highlight` (CSI code / vendor / person) flow through
every view, the KPI strip, and the agent's context. Deep links encode view state in the URL hash.

- **Ontology · 3D** — the centerpiece: projects as glowing globe clusters orbiting a lifecycle
  time-axis (radial distance = activity heat, angle = BU sector, size = data volume), flowing
  particles = records that actually changed in a chosen time window (from `kg_entity_facts`),
  vessel thickness = dollars carried. Mobile perf budget + fps watchdog + lite mode.
- **Ontology · Map** — every project as a dot on a d3-geo US/world basemap (TopoJSON, no tile
  servers): size = contract value, color = BU / stage / **cost health (CPI)**, same-city clusters,
  click → focus + KPI card, agent answers fly the map.
- **Ontology · Network** — the raw Sigma/WebGL graph with ForceAtlas2 in a web worker.
- **Data** — every entity in a sortable/filterable table; quantification panel; row → full
  domain record + neighbors; CSV export.
- **Analytics** — the KPI dashboards (Recharts), value-weighted, focus-aware, with a
  **plain-language KPI guide**: every metric label opens a what-it-is / what-good-means /
  what-bad-means card, and every chart has an "explain" panel. No AEC fluency assumed.
- **Ask dock** — the agent chat, always present, scoped to the current focus, markdown + streamed
  tool progress.

Accessibility and trust details that should survive the port: colorblind-safe palette option
(Okabe-Ito) with shape-coded legends, `prefers-reduced-motion` honored, a data-health banner that
distinguishes "no data" from "can't reach the API", and glossary provenance everywhere numbers
appear.

### 1.8 Operations

- **Deploys** — `vite build` + `wrangler pages deploy` (CI workflow authored but parked pending a
  workflow-scoped token). Edge functions via `supabase functions deploy`.
- **Refresh** — pg_cron: KPIs */30 min, history snapshot nightly. Full graph reprojection is
  deliberately manual (it would wipe embeddings; the drain needs a stored service key — a
  security decision, not an oversight).
- **Testing** — golden agent evals vs live cloud; headless browser verification harnesses
  (`app/verify-map.mjs`, `app/verify-analytics.mjs`) that assert rendering, interactions, and
  zero runtime exceptions at desktop + mobile viewports on every ship.
- **Scale caveats of the POC** (relevant when sizing the real thing): micro Postgres instance,
  PostgREST 1,000-row response cap (client paginates), ~5k-node comfort zone in the 3D view,
  5s/500-row agent queries.

---

## Part 2 — The Snowflake semantic layer: what it must provide, and what to consider

### 2.1 Shape of the port

ClayOS is treated as a **validated design pattern to re-implement inside Snowflake** — not an app
to point at Snowflake. Everything lives in one new schema; raw data never leaves the platform:

```
DB_CONTROL_TOWER (existing: 126 dynamic tables — JDE, PMWeb, ACC, Textura, TradeTapp, SmartPM; no FKs)
   └─► SCH_CLAYOS_SEMANTIC          (new schema — the entire semantic layer)
        ├─ ENTITIES / EDGES          dynamic tables = the ontology projection (port of migration 006)
        ├─ KPI_* views               port of migration 007, adapted (three EV bases — see 2.3)
        ├─ VENDOR_MASTER (+ review)  governed org crosswalk: JDE spine + PMWeb fuzzy-match
        ├─ PILOT_PROJECTS            config table — every object filters through it
        └─ Cortex Search service     entity semantic search (replaces pgvector; vectors stay in SF)
   └─► Agent: RUN_GUARDED_QUERY proc + CLAYOS_AGENT role (port of the kg_query harness)
        + Cortex Agents/Analyst so LLM calls need no data egress
   └─► UI: the ClayOS front-end pattern behind an approved gateway (Streamlit-in-Snowflake, or
        the React app on approved hosting + SSO), RLS from DT_ENTITLEMENT_*
```

Six scripts are already authored in `integrations/snowflake/` (setup → verification → vendor
master → entities/edges → KPI views → query harness). **Every warehouse column not directly
observed is tagged `[INFERRED]`** and the workflow is verification-first: nothing gets created
until `01_source_verification.sql` has been run and the inferred names corrected.

### 2.2 The contract: what each ClayOS surface needs from the semantic views

This is the checklist that defines "done" for the semantic layer — each UI/agent capability maps
to specific objects it consumes:

| ClayOS surface | Semantic objects required | Notes for Snowflake |
|---|---|---|
| Ontology viewers (3D/Map/Network) | `ENTITIES` (typed, BU-tagged, JSON properties), `EDGES` (typed relations), a subgraph-shaped read (type/BU filter + limit) | Deterministic natural-key IDs (`proj:12345`, `cost:12345:031000`) so the projection is rebuildable and stable across refreshes |
| Map view specifically | Project city/state — or better, real lat/long | The POC geocodes a fixed synthetic city list client-side; real projects have addresses, so the semantic layer should expose coordinates and make the map *better* than the demo |
| Activity flow (3D pulses) | A per-entity "last activity date + dollar amount" view (the `kg_entity_facts` analogue) | Cheap to derive from the BY_DAY tables; without it the 3D view still works, just static |
| Analytics dashboards | `KPI_EVM`, `KPI_SAFETY`, `KPI_FIELD`, `KPI_BACKLOG`, `KPI_PIPELINE`, `KPI_BU_ROLLUP` — per-project grain plus BU rollup | Keep per-project rows queryable (the UI charts top-N by signal but computes portfolio stats over the full set, value-weighted) |
| Trend charts | A history mechanism — either a scheduled snapshot table (the `kpi_history` pattern, via Snowflake task) or month-end positions derived from `DT_COST_MANAGEMENT_BY_DAY` | The POC snapshots nightly; the warehouse's daily tables can do better |
| KPI glossary / provenance | A provenance label on every derived measure | Non-negotiable with three EV bases in play — every number must say which basis it is (see 2.3.1) |
| Agent | `RUN_GUARDED_QUERY` proc, Cortex Search over `ENTITIES`, a schema-describe capability, and a `kg_kpi`-shaped "golden path" (a view the agent hits before writing SQL) | Port the tool registry as-is; only the transport changes |
| Selection/focus contract | One canonical project identifier | `PROJECT_NUMBER` via the `DT_PROJECTS_IN_SYSTEMS` crosswalk is the spine everywhere |
| Cross-cutting highlight | Classification coding on cost/contract entities (MasterFormat divisions exist in cost codes) | Optional for the pilot; it powers the "light up division 03 everywhere" feature |

### 2.3 The ten considerations

**1. EVM cannot be computed the textbook way — commit to the three-bases design.**
The warehouse has budget, actuals, committed, and (to be confirmed) a forecast-at-completion —
but **no earned value and no planned value** (no cost-loaded schedule). The POC's
`cost_progress` table simply doesn't exist in reality. The port therefore computes **three EV
proxies side by side**, each with its own CPI/SPI, and treats divergence between them as a
first-class analytic rather than pretending one is the truth:

| Basis | Formula | Reads as | Caveat |
|---|---|---|---|
| `EV_CF` (default lens) | BAC × AC / EAC → CPI_CF = BAC/EAC | budget vs. forecast-at-completion | needs the forecast column (verification Q1) |
| `EV_SCHED` | BAC × SmartPM % complete | schedule-flavored progress | project-grain, coarse; coverage is Q5 |
| `EV_BILL` | billed-to-date | billing basis | **never the default CPI** — it forces the WIP signal to ~0 by construction |
| `PV_LIN` | BAC × linear time elapsed between planned start/finish | shared SPI denominator | explicitly labeled a derived proxy |

Every row carries `PROVENANCE = 'derived: EV/PV proxies — not cost-loaded-schedule EVM'`, and a
`KPI_EV_BASIS_COMPARE` view quantifies the spreads (`EV_BILL ≫ EV_CF` → front-loaded billing;
`EV_CF ≫ EV_SCHED` → optimistic cost forecast or stale schedule data). The UI glossary pattern
(what/good/bad per metric) extends naturally to explain the bases to non-specialists — plan for
that copy, not just the SQL.

**2. Identity is the hard problem — resolve it in the layer, don't assume it away.**
`DB_CONTROL_TOWER` has **zero foreign keys**; joins are by naming convention, keys are
per-source-system, and vendor identity across JDE/PMWeb/Textura is only fuzzy-matched. The
semantic layer is where this gets governed:

- **Projects**: `PROJECT_NUMBER` is the spine; `DT_PROJECTS_IN_SYSTEMS` is the crosswalk. Strong.
- **Vendors**: `VENDOR_MASTER` treats the JDE address book as the canonical Organization spine and
  attaches PMWeb identities through the existing fuzzy-match table with explicit thresholds —
  **≥ 0.90 auto-link, 0.70–0.90 into a human review queue, < 0.70 stays separate**. Deliberately
  under-merge: a false merge poisons every downstream join; a missed merge is just two nodes.
  (Normalized names + trigram similarity beat embeddings for short company names.)
- **Entity IDs** are natural keys (`source:type:key`), never surrogates — the projection stays
  deterministic and rebuildable, the property the POC gets from `UNIQUE(source_table, source_id)`.

**3. Grain and scale — aggregate before you project.**
The POC is deliberately small; the warehouse is not (`DT_COST_MANAGEMENT_BY_DAY` ≈ 98.6M rows,
labor-hours tables 24M+19M+4.2M). Two rules keep the layer fast and the graph legible:

- **Snapshot heavy facts to consumable grain in views** — cost position is exposed as month-end
  (+ latest day) per project; consumers never touch the 98M-row table.
- **Not everything becomes a node.** Daily-log/hours rows stay relational (they only exist to be
  summed into TRIR); projecting them would add ~100k meaningless nodes at 200 projects. The pilot
  entity set is Project, Organization, Contract, CostAccount, RFI/Issue, SafetyEvent, PayApp,
  Pursuit.
- **Dynamic tables replace the trigger ladder** (`TARGET_LAG = '1 day'` on a dedicated XS
  warehouse). Same projection logic, better fit — Snowflake keeps them fresh, and a rebuild is
  `CREATE OR REPLACE`, mirroring `kg_reproject_all()`.
- The UI's 3D view is comfortable to ~5k nodes; at 200 real projects plan the BU-rollup /
  expand-on-demand LOD already noted in the POC roadmap.

**4. Verification-first: five source facts gate everything.**
The scripts were authored from a data-map assessment, not live introspection, so
`01_source_verification.sql` must run first and its answers get recorded before anything is
created. The five questions that decide the mapping:

1. What is the forecast/EAC column in `DT_COST_MANAGEMENT(_BY_DAY)`? (decides whether `EV_CF` is
   computable at all)
2. What grain is owner billing / SOV — `DT_WIP_DATA` vs the AR tables? (decides the PayApp and
   `EV_BILL` source)
3. Do RFIs live in PMWeb or as ACC/Autodesk issues? (decides the RFI entity source)
4. Is the JDE fiscal calendar = calendar months? (decides month-end snapshot correctness)
5. What is SmartPM % complete coverage across the pilot slate? (decides whether `EV_SCHED` is
   presentable)

**5. Data-quality gates are part of the layer, not an afterthought.**
Known-broken or stale objects are excluded by policy and asserted against:
`DT_SUSTAINABILITY_UTILITY_ESTIMATES` (0 rows), `LU_SPEC_CHANGE_EVENT_AT_RISK` (0 rows),
`DT_SUBCONTRACTOR_DIVERSITY_GOALS` (stale), `TBL_DATES2`/`TBL_DATES_COPY`. Everything the layer
*does* consume gets freshness assertions (row count > 0, max date within lag). The POC's UI
equivalent — the "can't reach the data vs. genuinely zero" banner — should carry over: silent
zeros destroy trust fastest.

**6. The sensitive-data boundary is structural.**
Nothing in the layer reads `DT_PEOPLE_DATA` or any `_SENSITIVE` object. Payroll appears only as
project × day hour aggregates; safety facts carry **no person identifiers**. HR/staffing analytics
(the POC's utilization view) stay synthetic until a governed path exists. Because the agent role
has no grants outside the semantic schema (next item), these exclusions are enforced by the
privilege model, not by convention.

**7. The agent security harness ports as three layers — keep all three.**

- **Layer 1, structural:** two roles. `CLAYOS_BUILDER` owns the schema and reads raw sources;
  `CLAYOS_AGENT` (the runtime role) has SELECT **only on `SCH_CLAYOS_SEMANTIC`**. The guarded
  proc is `EXECUTE AS CALLER`, so even a validation bypass cannot reach raw or `_SENSITIVE`
  schemas — there is simply no grant.
- **Layer 2, validation:** `RUN_GUARDED_QUERY()` mirrors the POC's `kg_query`: single statement
  only, must start SELECT/WITH, keyword blocklist (incl. Snowflake-specific `COPY`, `MERGE`,
  `CALL`, `PUT`, `EXECUTE TASK`), explicit block on referencing other schemas /
  `INFORMATION_SCHEMA` / `SNOWFLAKE.*`, results wrapped in `LIMIT 500`.
- **Layer 3, resource:** dedicated `WH_CLAYOS_XS` (auto-suspend 60s, 60s statement timeout, 15s
  session cap inside the proc) under a resource monitor (20 credits/month, notify at 75%,
  suspend at 100%). Runaway cost is capped by construction.
- Service user is **key-pair only**, no password, optional network policy pinned to the runtime's
  egress IPs; credentials stored per Clayco policy — never in the POC stack.

**8. Row-level security comes almost for free — use the entitlement tables.**
`DT_ENTITLEMENT_COMPANIES` / `DT_ENTITLEMENT_PROJECTS` already drive Tableau RLS. Mapping them
onto Snowflake **row-access policies** on `ENTITIES`, `EDGES`, and the KPI views gives per-user
scoping that matches governance people already trust — the POC's role/claim scaffolding
(migration 012) was designed to line up with exactly this.

**9. Search and LLM should stay in-platform.**
Cortex Search over `ENTITIES` replaces pgvector (vectors never leave Snowflake); Cortex
Agents/Analyst can host the tool loop with Claude models **inside** Snowflake, so agent calls
involve no data egress at all — the cleanest possible governance story. `01` probes whether
Cortex is enabled; if it is not, the fallback is the external-runtime pattern (the POC's edge
function shape) pointed at `RUN_GUARDED_QUERY` through the service user — workable, but the
egress conversation with IT happens then.

**10. Know what the warehouse cannot feed — and what it adds.**
Stays synthetic/empty in the real deployment (no upstream source): activity-level CPM schedule
and dependencies (SmartPM is summary-grade), submittal facts, estimate/bid detail, BIM grain
(spaces/elements/documents), persons/staffing. Don't fake these — the UI degrades gracefully.
Conversely the warehouse is richer than the POC in places the POC never modeled: change-event
lifecycle (PMWeb), sub prequalification/bonding (TradeTapp), sub payment detail (Textura), GL
journal grain (15.6M rows), AP lifecycle, diversity/MWBE. The two highest-value additions after
the pilot: **change events** and **TradeTapp + Textura** — together they enable the subcontractor
scorecard (prequal × payment × safety × changes per vendor), which no single warehouse table can
produce but the graph join makes straightforward. The pursuit→project bridge (DT_OPPORTUNITY has
no project link today) is another thing the ontology fixes that the warehouse cannot.

### 2.4 What is already written

| Script | Contents | Gate |
|---|---|---|
| `00_setup.sql` | roles (`CLAYOS_BUILDER`/`CLAYOS_AGENT`), key-pair service user, `WH_CLAYOS_XS` + resource monitor, semantic schema, `PILOT_PROJECTS` config | SECURITYADMIN/SYSADMIN + schema-owner approval |
| `01_source_verification.sql` | live introspection, the 5 mapping questions, broken-object and freshness assertions, Cortex probe | read on the operations schema |
| `02_vendor_master.sql` | JDE-spine vendor crosswalk + fuzzy-match import + review queue | 01 verified |
| `03_entities_edges.sql` | `ENTITIES`/`EDGES` dynamic tables (natural-key IDs, pilot-filtered) | 02 |
| `04_kpi_views.sql` | month-end cost position, `KPI_EVM` (3 bases), `KPI_EV_BASIS_COMPARE`, safety/field/backlog/pipeline/BU rollup, reconciliation export | 01 verified |
| `05_query_harness.sql` | agent grants, `RUN_GUARDED_QUERY`, guard tests, Cortex Search DDL | 00 |

`PILOT_PROJECTS` is the scale dial: every semantic object joins through it, so going from a
10–20 project pilot to all ~200 active projects is an INSERT, not a rewrite.

### 2.5 Phasing and exit criteria

- **Phase 0 — governance (open, on Clayco):** schema/change-control approval from the
  DB_CONTROL_TOWER owner (CLYCO_DATAENGINEERS); is Cortex enabled; which app hosting/gateway is
  approved; service-user key pair provisioned; pilot slate picked (10–20 projects across 2 BUs
  with healthy PMWeb + JDE coverage).
- **Phase 1 — semantic layer, no UI/agent:** run 00–04. **Exit: per-project KPI reconciliation
  against Tableau/source for every pilot project** (the `KPI_RECONCILIATION` view exists for
  exactly this), sane entity/edge counts, zero orphan edges, vendor review queue < ~50 rows.
- **Phase 2 — agent:** run 05, stand up search + the tool loop per the Phase-0 hosting answer.
  **Exit: the guard provably rejects writes / multi-statement / out-of-schema reads, and a golden
  eval set (reusing the POC's harness pattern) answers "which pilot projects are forecasting over
  budget and why" with real, cited numbers.**
- **Phase 3 — UI at scale:** front-end behind the approved gateway with SSO, RLS via row-access
  policies, graph LOD for 200 projects, then widen domains (change events, sub scorecard, GL
  drill-down).

### 2.6 Summary for the Snowflake team

Build one schema that exposes: a **deterministic, natural-keyed entity/edge projection**
(dynamic tables, pilot-filtered, sensitive-free), **KPI views that are honest about their
provenance** (three EV bases, labeled, with a divergence view), a **governed vendor crosswalk**
with human review, a **three-layer guarded query path** for the agent, and **row-access policies
from the entitlement tables** — all verified against source before anyone sees a number, all
sized by a config table so the pilot widens without rework. Everything else — the app, the agent
loop, the eval harness, the glossary UX — is already built and proven against the synthetic
twin; the semantic layer is the piece that lets it run where the real data lives.

---

*Repo: github.com/jpm72780/clayos — POC architecture in `docs/ARCHITECTURE.md` + `docs/DECISIONS.md`
(ADRs); Snowflake scripts in `integrations/snowflake/`; plan of record:
`~/.claude/plans/db-control-tower-data-map-robust-comet.md`. Compiled 2026-08-02.*
