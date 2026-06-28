# ClayOS — Progress Log

> **Living document.** Append a dated entry at the end of each working session.
> Newest first. Keep entries short: what changed, what was verified, what's next.

---

## 2026-06-28 — Session 3 (Opus 4.8): top-15 improvements + data expansion (overnight, autonomous)

**Context.** User asked to deep-dive state, list 15 improvements, then plan + execute all 15 overnight
plus add more data (incl. Clayco's development arm, CRG). Plan approved; executed in phases, shipping
incrementally (build → headless verify → wrangler deploy → commit) so the live app never broke.

**Shipped live (commits a8df2bd → f5f41ae):**
- **Phase A** — fixed Analytics Recharts (ResponsiveContainer needed `min-w-0`); surfaced unused KPI
  matviews (kpi_wip/backlog/pipeline/resource_util) as new Analytics sections; Analytics scopes to the
  focused project; Data table scopes to vendor/employee highlight (via kg_neighbors) + CSV export;
  URL-hash deep-link state; deleted dead AskView.
- **Phase C** — `kg_query` text-to-SQL tool (migration 011: `kg_query_safe`, SELECT/WITH-only, single
  statement, owned by clayos_readonly, 5s/500-row caps) + structured agent view-control (`@@VIEW@@`
  markers → focus/highlight). Deployed agent-ask. Verified live (focus DC-001; kg_query aggregate).
- **Quality** — ErrorBoundary; Data table render cap (800); `evals/` agent regression set.

**Done locally, CLOUD re-seed pending user (safety system blocked autonomous prod rebuild):**
- **Phase B** — `seed/generate.py`: CRG BU + 2 CRG projects, deepen all projects, stage-aware field
  activity, sector-aware spaces/elements, 12-month kpi_history backfill. Local verified: 6 BUs, 8
  projects, ~1,711 entities, 318 history rows; CRG EVM sane. Analytics CPI/SPI trend chart added (live,
  populates after cloud re-seed). Prepared `scripts/reseed-cloud.sh`.

**Scaffolding (local, non-breaking):** migration 012 — field/exec RLS roles + JWT-claim helper (RLS not enabled).

**Gotchas:** Recharts width-collapse = missing `min-w-0`; `SET ROLE` is illegal in SECURITY DEFINER →
own the fn as clayos_readonly (needs CREATE on schema to set owner); seed pct_complete clamped to [0,100].

**Next:** run `./scripts/reseed-cloud.sh`; then optional pg_cron/CI, RLS enforcement, semantic search,
2D/Network cross-filter, 3D-view refactor. See DECISIONS ADR-009/010/011.

---

## 2026-06-28 — Session 2 (Opus 4.8): unified 3D "vascular" ontology interface

**Context.** User reviewed the live app and steered the ontology hard toward a Palantir-AIP /
OrgMap-style **single linked-selection workspace** ("one interface for everything"), with an
ontology that "tells a story by just looking at it" and "feels like flying around interwoven
vascular systems that talk to each other."

**Did (frontend only — backend/data/agent untouched this session):**
- Reshaped the ontology through several iterations, all deployed to https://clayos.pages.dev:
  1. **2D lifecycle "story"** (`LifecycleView.jsx`, SVG): projects as data-mass mounds along the
     lifecycle; the portfolio data profile forms a bell; an enterprise-backbone lane underneath.
  2. **Cross-cutting "Highlight by" filters**: MasterFormat/CSI · UniFormat · Vendor · Employee —
     light a key across every project at once. Backed by `classification_codes` + `entities.classification_id`
     via PostgREST (no schema change). Verified: Concrete (03 00 00) lights 5–6 projects.
  3. **3D** (`Lifecycle3DView.jsx`, `3d-force-graph`+`three`): first as domain-layer towers, then per
     user direction → **floating globe-clusters in the ether** (x=lifecycle into depth, BU-tinted,
     faint membrane), all edges connected across clusters.
  4. **Unified interface**: docked **selection-driven KPI strip** (click a project → CPI/SPI/EAC/RFIs/TRIR
     rescope; verified Cedar Rapids → CPI 1.06/SPI 1.04/TRIR 4.38) + docked **Ask** box (selection context).
  5. **"Vascular" aesthetic**: thin vessels, bloom + depth fog, drifting auto-orbit, **flowing particles =
     data points that "moved" in a time-window** with window/speed/size sliders + live "N moved" count.
- Toned bloom + added label chips so text stays crisp; fixed a one-time particle init error
  (self-loop filter + `cooldownTicks(1)`); made decorative meshes non-raycastable so node clicks register.
- Verified throughout with headless-Chromium (swiftshader) screenshots + driven interactions
  (KPI rescope, flow-window gating 1h/24h/30d → 0/27/744 moved).

**Deps added:** `3d-force-graph`, `three`, `three-spritetext` (3D chunk lazy-loaded).
**Decision:** see DECISIONS ADR-008.

**Next (in progress):** enrich the flow — (1) pulse colour/speed by domain+recency + hub pulse,
(2) **real recency** from domain dates (migration 010 `kg_entity_facts()`), (3) **$-weighted vessel
thickness**. Then keep deepening the unified workspace.

---

## 2026-06-27 — Session 1 (Opus 4.8), part 3: Phase 1 LIVE (build + provision)

**Did:**
- Built edge functions: `_shared/{cors,db,embeddings,kg_tools}.ts`, `agent-ask` (Claude opus-4-8 32-turn
  tool loop, read-only kg_* tools), `embed-entities` (drain graph_embed_jobs). Consulted claude-api skill
  (model `claude-opus-4-8`, no temperature/thinking).
- Built frontend (React 19 + Vite 6 + Tailwind 4): App shell + BU filter, GraphView (Sigma+graphology
  forceAtlas2 + drill-down right rail), DashboardView (Recharts: CPI/SPI, BAC vs EAC, RFIs, TRIR + BU
  rollup strip), AskView (chat → agent-ask). Production build OK (978KB).
- **Provisioned cloud:** created Supabase project `fwaydsjpudusbaeyccjc` (us-east-2, PG17); applied all 9
  migrations + seed (750 entities/1004 edges); exposed `clayos` schema to PostgREST via mgmt API; deployed
  both edge functions + secrets; drained all 750 embeddings.
- **Verified agent end-to-end** against live cloud — grounded cited answer (Aurora CPI 0.91 / SPI 0.839 /
  EAC $396.9M / TRIR 9.27 / 19 open RFIs).
- Deployed frontend to **https://clayos.pages.dev** (Cloudflare Pages); verified HTTP 200 + anon PostgREST
  data paths (kg_bu_rollup, kpi_evm, kg_subgraph 528 nodes).
- Pushed code to **github.com/jpm72780/clayos**.

**Gotchas / decisions:**
- Seed `SET session_replication_role` removed (superuser-only on Supabase).
- PostgREST didn't know `clayos` schema → set via mgmt API PATCH (config.toml only affects local).
- Pooler host is `aws-1-us-east-2` (not aws-0); DDL needs session pooler port 5432.
- GitHub auth: gh token lacks `workflow` scope, PAT lacks repo access → workflow parked in `docs/deploy/`,
  CI not enabled, deploys via wrangler. See INFRA.md.

**Final verification:** live app HTTP 200; agent re-verified on a 2nd question type (worst safety record →
Aurora TRIR 9.27 vs Cedar Rapids 4.38, correct comparison). Docs reviewed + synced. **Session 1 ends with
Phase 1 fully live.**

**Next:** Phase 2 (browser-verify UI, enable CI + pg_cron, kg_query text-to-SQL, RLS scoping).

---

## 2026-06-27 — Session 1 (Opus 4.8), part 2: Phase 0 COMPLETE

**Did:**
- Wrote migrations **004** (35 domain tables), **005** (entities/edges + kg_traverse/kg_subgraph/
  kg_neighbors/kg_search), **006** (projection engine: project_entity/project_edges/project_to_graph,
  generic trigger on 23 tables, graph_embed_jobs, kg_reproject_all, embed-drain helpers),
  **007** (8 KPI matviews + kg_bu_rollup + kpi_history + refresh/snapshot + kg_project_kpis),
  **008** (grants + clayos_readonly role), **009** (pg_cron, guarded).
- Verified all 9 apply clean on local pgvector PG. Smoke-tested projection + traverse.
- Built `seed/generate.py` (deterministic, SQL-to-stdout, driver-free). Seeded 750 entities /
  1004 edges. Verified EVM/WIP/safety/field/rollup numbers are realistic and self-consistent.
- **Phase 0 exit criteria MET.**

**Bugs found & fixed:**
- 009: nested `$$` dollar-quote collision (DO block + inner cron strings) → renamed DO tag to `$do$`.
- `kg_project_kpis` keyed only on domain project_id; made it accept a Project entity id too.
- `scripts/db.sh reset` can't rm `.pgdata` (owned by container postgres uid) → use DROP SCHEMA.

**Verified numbers (known-good):** Aurora SPI 0.84/CPI 0.91 (over+behind), Cedar Rapids 1.04/1.06;
Aurora overbilled +$17.5M; TRIR 9.27 vs 4.38; enterprise rollup $1.79B over 6 projects.

**Next:** Phase 1 — embeddings drain, agent-ask + kg_tools, frontend (Sigma/Recharts/chat), provision.

---

## 2026-06-27 — Session 1 (Opus 4.8): planning + scaffold

**Context.** New project kicked off. User wants a "company operating system" for Clayco:
ontology/knowledge-graph viewer + reporting + KPI + agentic Q&A + (later) app builder.

**Did:**
- Ran 3 Explore agents (counterpart stack inventory, infra recon, construction-domain research)
  + 1 Plan agent. Findings drove the architecture.
- Approved plan written to `/home/clawd/.claude/plans/lets-create-a-new-breezy-curry.md`.
- User confirmed 4 decisions: synthetic seed · thin slice all 5 layers · new repo + new Supabase +
  Postgres-native graph · depth-first (3 BUs, 5-6 projects).
- Scaffolded repo at `/home/clawd/projects/clayos`: README, .gitignore, docker-compose (local
  pgvector PG @ 54329), `scripts/db.sh`.
- Wrote migrations **001** (extensions + helpers), **002** (classification), **003** (business_units).
- Designed migration **004** (all domain tables) — captured in `docs/ARCHITECTURE.md`; not yet
  committed to disk (Write interrupted).
- Created this living docs set (HANDOFF, ARCHITECTURE, PROGRESS_LOG, DECISIONS, INFRA, ROADMAP).

**Verified:** nothing run against a DB yet. No infra provisioned.

**Next:** write 004-006, start local PG, apply migrations, then 007-009 + seed. See HANDOFF "Next actions".

**Notes / gotchas discovered:**
- counterpart uses `claude-opus-4-7`/`claude-sonnet-4-6` model pins — verify current IDs via the
  claude-api skill before wiring `agent-ask` (don't copy stale pins).
- n8n API-created workflows can't resolve UI-created credentials (build in UI). Not relevant until
  ingestion phase.
- Cloudflare Pages (wrangler) rejects unicode in commit titles — keep commit messages ASCII.
