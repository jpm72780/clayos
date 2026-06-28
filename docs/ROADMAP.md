# ClayOS — Roadmap & Phase Checklist

> **Living document.** Tick boxes as work completes. Each phase has an explicit exit criterion.
> Current phase: **Phase 0 (Foundation)**.

## Phase 0 — Foundation (schema + seed)  ✅ COMPLETE (2026-06-27)
- [x] Repo scaffold (README, .gitignore, docker-compose, scripts/db.sh)
- [x] Migration 001 — extensions + helpers
- [x] Migration 002 — classification systems/codes
- [x] Migration 003 — business_units
- [x] Migration 004 — domain tables (35 tables)
- [x] Migration 005 — entities/edges + kg_traverse/kg_subgraph/kg_neighbors/kg_search RPCs
- [x] Migration 006 — projection fns + triggers + graph_embed_jobs + kg_reproject_all()
- [x] Start local PG (`scripts/db.sh up`) + apply 001-009 clean
- [x] Migration 007 — KPI matviews + kg_bu_rollup + refresh_all_kpis() + kpi_history
- [x] Migration 008 — RLS/grants + clayos_readonly role
- [x] Migration 009 — pg_cron (guarded)
- [x] `seed/generate.py` (curated MasterFormat/UniFormat inline); seed 3 BUs / 6 projects
- [ ] Embed entities (OpenAI) so kg_search works  ← moved to Phase 1 (needs key/edge fn)
- **Exit ✅:** kg_traverse returns cross-domain paths (Aurora→255 @2hops); kg_bu_rollup sensible
  ($1.79B/6 projects); Aurora CPI 0.91 & SPI 0.84 (<1). 750 entities / 1004 edges.

## Phase 1 — First vertical slice (the demo)  ✅ COMPLETE & DEPLOYED (2026-06-27)
Scope: all five layers thin, live. **App: https://clayos.pages.dev**
- [x] Edge function `agent-ask` (forked loop) + `kg_tools.ts` (search/get_entity/traverse/kpi/classification/schema)
- [x] Edge function `embed-entities` (drain graph_embed_jobs) — all 750 embedded
- [x] Frontend scaffold (React 19 + Vite 6 + Tailwind 4) + Supabase client
- [x] GraphView (Sigma.js + graphology): filter by BU/domain, click node → real record in right rail
- [x] DashboardView (Recharts): CPI/SPI, BAC vs EAC, RFIs, TRIR + BU rollup strip
- [x] AskView (chat) → agent-ask
- [x] `app_*` stub tables present (in 004)
- [x] Provisioned Supabase + Cloudflare Pages + GitHub; deployed end-to-end
- **Exit ✅:** agent answers "which Clayco Compute projects are over budget and why" with grounded, cited
  numbers (Aurora CPI 0.91, EAC $396.9M). Browser visual-verify of the UI = the one remaining check (Phase 2 #1).

## Phase 2 — Widen + deepen
- [ ] All 3 BUs, full lifecycle coverage in seed
- [ ] `kg_query` text-to-SQL with the safety harness (clayos_readonly, single-SELECT, timeout)
- [ ] WIP/backlog/TRIR/utilization matviews + kpi_history trend charts
- [ ] RLS scoping by role (field user vs. exec) + per-turn world-state injection tuned

## Phase 2.5 — Unified 3D "vascular" ontology workspace (session 2, 2026-06-28) — IN PROGRESS
Single linked-selection interface (ADR-008). Live at https://clayos.pages.dev.
- [x] 2D lifecycle "story" view (SVG) — projects as data-mass mounds + bell + backbone lane
- [x] Cross-cutting "Highlight by" filters (MasterFormat/CSI · UniFormat · Vendor · Employee)
- [x] 3D ontology (`3d-force-graph`): floating project globe-clusters, lifecycle into depth
- [x] Selection-driven docked KPI strip + docked Ask agent (click project → rescope)
- [x] "Vascular" aesthetic: thin vessels, bloom/fog, drifting orbit, time-windowed activity flow
- [ ] Flow enrichment: pulse colour/speed by domain+recency + hub pulse
- [ ] Real recency from domain dates (`kg_entity_facts()` migration 010)
- [ ] $-weighted vessel thickness (contracts/pay-apps/cost/estimates)
- [ ] Deepen unification: filters also rescope KPIs; agent can drive the view (highlight/focus)

## Phase 3 — Polish
- [ ] Viewer LOD / expand-neighborhood perf pass
- [ ] Agent eval set (golden Q→A)
- [ ] Executive portfolio dashboard

## Phase 4+ — Roadmap (post-POC)
- [ ] App/workflow builder UI + per-app RLS (app_id claim) + MCP-style tool exposure
- [ ] Real ingestion connectors via n8n (Procore / Autodesk Construction Cloud / ERP)
- [ ] Optional: migrate graph to Apache AGE / Neo4j if traversal perf demands (ADR-001)
- [ ] Optional: RDF / ifcOWL / BOT alignment layer for semantic interoperability

## Provisioning (cross-cutting — see INFRA.md checklist)
- [ ] ClayOS Supabase project · [ ] GitHub repo · [ ] Cloudflare Pages project · [ ] deploy
