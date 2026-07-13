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
- [x] Embed entities so kg_search works (all 1,711 drained; Claude-side embeddings — done session 3)
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
- [x] All BUs + CRG dev arm, deeper lifecycle coverage in seed (session 3 Phase B — 8 projects, 1,711 entities)
- [x] `kg_query` text-to-SQL with the safety harness (session 3 Phase C — migration 011)
- [x] WIP/backlog/TRIR/utilization surfaced in Analytics + kpi_history trend charts (session 3)
- [ ] RLS scoping by role (field user vs. exec) + per-turn world-state injection tuned

## Phase 2.5 — Unified 3D "vascular" ontology workspace (session 2, 2026-06-28) — IN PROGRESS
Single linked-selection interface (ADR-008). Live at https://clayos.pages.dev.
- [x] 2D lifecycle "story" view (SVG) — projects as data-mass mounds + bell + backbone lane
- [x] Cross-cutting "Highlight by" filters (MasterFormat/CSI · UniFormat · Vendor · Employee)
- [x] 3D ontology (`3d-force-graph`): floating project globe-clusters, lifecycle into depth
- [x] Selection-driven docked KPI strip + docked Ask agent (click project → rescope)
- [x] "Vascular" aesthetic: thin vessels, bloom/fog, drifting orbit, time-windowed activity flow
- [x] Flow enrichment: pulse colour by domain + speed by recency + hub pulse on active projects
- [x] Real recency from domain dates (`kg_entity_facts()` migration 010; flow window = actual seed dates)
- [x] $-weighted vessel thickness (contracts/pay-apps/cost/estimates, log-scaled)
- [x] Deepen unification: Highlight-by filters rescope the KPI strip (slice rollup: $ carried / data
      points / projects / type breakdown); camera fly-to a project on focus; agent drives the view
      (answer names a project → focus + fly there). Verified: Concrete slice = $421M / 6 projects;
      "status of Riverside?" → auto-focus Riverside.
- [x] **Data Explorer** (new "Data" tab, `DataView.jsx`): every entity as one sortable/filterable table
      (Type/Name/Domain/Project/BU/CSI/$ amount/last activity) + row→detail. 750 rows, $10.58B total.
- [x] Flow UX: slower/larger pulses by default, 60-day default window; greyed-out (non-highlighted)
      nodes become non-hoverable/non-selectable (raycast off) so the colored ones are easy to grab.
- [x] **Cross-filter** the pages: shared `focus`/`hl` state lifted to App. Ontology Highlight-by key
      scopes the Data table (chip); a Data row → "view in ontology" focuses + flies the 3D camera;
      ask/agent focus follows across tabs. Verified: CSI Metals → 35/750 rows; row → focus Aurora.
- [x] **Data quantification panel** (filter-reactive): data points, $ value, moved 7/30/60d, by-domain
      bars, by-type (clickable), status/disposition cards (RFI open/answered, etc.).
- [x] **Clayco Analytics** (was Reporting): added calculated portfolio KPIs — backlog/forecast/overrun,
      value-weighted CPI/SPI, # over budget, # behind schedule, open RFIs, portfolio TRIR.
- [x] **Rebrand**: Clayco Ontology / Clayco Data / Clayco Analytics; dropped "ClayOS"; the agent is now
      a small constant **Ask dock** in the bottom-right corner on every page (replaces the Ask tab).

## Phase 2.6 — Top-15 improvements (session 3, 2026-06-28)
Shipped live:
- [x] Fix Analytics charts (Recharts `min-w-0`)
- [x] Surface hidden KPI matviews (WIP / backlog / pipeline / utilization) in Analytics
- [x] Cross-filter: Analytics scopes to focus; Data scopes to vendor/employee highlight
- [x] CSV export + URL-hash deep-link state
- [x] `kg_query` text-to-SQL agent tool (guarded) + structured agent view-control (`@@VIEW@@`)
- [x] ErrorBoundary; Data table render cap; agent eval set (`evals/`)
Data expansion — LIVE on cloud (re-seeded 2026-06-29 via `scripts/reseed-cloud.sh`):
- [x] CRG dev BU + 2 projects, deepen all, stage-aware activity — 8 projects / 1,711 entities live
- [x] kpi_history trend backfill + Analytics CPI/SPI trend chart (318 rows live)
- [x] Resilience: data-health banner; URL hash persists only tab/onto-mode
Designed / deferred:
- [~] RLS field/exec scaffolding (migration 012, not enabled)
- [ ] Enable pg_cron + CI auto-deploy (#4 — CI blocked by token scope)
- [ ] Semantic search in the UI (#11); 2D/Network cross-filter; split Lifecycle3DView (#14b)
- [ ] kg_entity_facts pagination (PostgREST 1,000-row cap vs 1,711 entities)
- [ ] Robustness: avoid hammering the `micro` Supabase instance (edge abuse-protection 503s)

## Phase 2.7 — External-review response (session 4, 2026-06-29)
Plan: `/home/clawd/.claude/plans/sparkling-singing-lighthouse.md` (3 issues + 10 improvements, 4 phases).
**Phase 1 — the 3 visible issues — SHIPPED LIVE:**
- [x] #2 Markdown rendering of agent answers (`react-markdown`+`remark-gfm` in AskDock)
- [x] #3 Streaming agent responses over SSE (tool-progress labels + token deltas + typing indicator); JSON path kept for evals
- [x] #1 Fix 3D `reading 'x'` crash (`enableNodeDrag(false)` — DragControls→OrbitControls pointerup); reproduced + verified 0 exceptions
- [x] Eval harness bug fix (`URL` shadowing) + refreshed safety golden post-reseed
**Phase 2 — ontology UX & reliability — SHIPPED LIVE:**
- [x] #4 Resizable / expandable chat dock (drag grip + expand toggle + localStorage)
- [x] #5 Onboarding / "what am I looking at?" overlay (`OntologyIntro`, persisted + "?" reopen)
- [x] #9a 3D perf: lite quality mode (no bloom/particles, lower res) + auto-downgrade <25 fps
- [x] B1 — fixed 1,000-row PostgREST cap (`fetchAllRows` Range paging + `fetchAllRpc` limit/offset paging)
- [~] Network LOD (deferred — Sigma already has label thresholds + iteration caps; revisit with #9b)
**Phase 3 — cross-cutting clarity — SHIPPED LIVE:**
- [x] #6 Global active-filter bar + clear-all + scope indicator + 🔗 copy-link (App.jsx)
- [x] #8 Analytics zero-states (support-group BU cards; "no data" vs 0 with tooltips)
- [x] #10 Per-chart CSV + PNG export, "✦ ask Clayco about this", explicit shareable deep-link
**Phase 4 — accessibility & responsive — SHIPPED LIVE:**
- [x] #7 color/shape encoding (`TYPE_SHAPE` glyphs in legends + table), Data table ARIA (scope/aria-sort/
      keyboard rows/focus), `aria-label`s on controls, 3D drift off under prefers-reduced-motion
- [x] #9b responsive: header wrap, detail rails `max-w-[80vw]`; verified no overflow at 834/390px
- [~] Deferred: ~~full phone nav-drawer for 3D/graph side rails~~ (done in 2.8); graph node-by-node keyboard cycling; network LOD

## Phase 2.8 — Phone drawers + clarity & display prefs (session 5, 2026-07-13) — SHIPPED LIVE
- [x] Phone nav-drawers: 3D + Network side rails become ☰-opened fixed drawers; detail rails become
      bottom sheets; Sigma/3D canvases resize via ResizeObserver (+ DPR clamp ≤2 on the 3D renderer)
- [x] Global per-tab help: header "?" opens `HelpModal` (plain-language companion to the poetic intro)
- [x] Skeleton loading states (`Skeleton.jsx`): Data table + Analytics stats/cards shimmer while loading
- [x] KPI glossary (`glossary.js defOf`): hover definitions (CPI/SPI/EAC/TRIR/WIP/backlog…) on dotted-underlined
      labels in Analytics + the 3D KPI strip
- [x] Display preferences (`prefs.js` + header ⚙): colorblind-safe palette (`TYPE_COLOR_CB`, Okabe-Ito;
      hue = family to match TYPE_SHAPE, lightness = type), higher-contrast mode (CSS tier lift),
      literal labels (plain terms replace the vascular metaphor in the 3D view)
- [x] Fixed 24px horizontal overflow at 390px (header BU select); inline SVG favicon (was a 404 every visit)
- [x] Verified headless (snap chromium + puppeteer-core): 17/17 checks, 0 exceptions at 1440px + 390px

## Phase 3 — Polish
- [ ] Viewer LOD / expand-neighborhood perf pass
- [x] Agent eval set (golden Q→A) — `evals/`
- [ ] Executive portfolio dashboard

## Phase 4a — Snowflake semantic layer (DB_CONTROL_TOWER) — STARTED 2026-07-13
Direction change: Supabase is NOT Clayco-approved for real data, so instead of ingesting into the
clayos schema, the ClayOS pattern (projection + KPIs + guarded agent query) is **ported into
Snowflake**. Plan: `/home/clawd/.claude/plans/db-control-tower-data-map-robust-comet.md`.
- [x] Gap assessment + integration plan (approved)
- [x] Artifact set authored: `integrations/snowflake/` (00 setup · 01 source verification ·
      02 vendor master · 03 entities/edges dynamic tables · 04 KPI views w/ 3 EV bases ·
      05 guarded query harness) — **all warehouse columns [INFERRED], 01 must run first**
- [ ] Phase 0 gate: governance approvals, service user, run 01, record verified facts, pick pilot slate
- [ ] Phase 1: build semantic schema over 10–20 pilot projects; KPI reconciliation vs Tableau
- [ ] Phase 2: agent on Snowflake (harness + Cortex Search; host per governance answer)
- [ ] Phase 3: UI at scale (SSO gateway, entitlement-based RLS, 3D LOD for 200 projects)

## Phase 4+ — Roadmap (post-POC)
- [ ] App/workflow builder UI + per-app RLS (app_id claim) + MCP-style tool exposure
- [ ] Real ingestion connectors via n8n (Procore / Autodesk Construction Cloud / ERP) —
      superseded for Clayco data by Phase 4a (Snowflake-native); still relevant for non-warehouse sources
- [ ] Optional: migrate graph to Apache AGE / Neo4j if traversal perf demands (ADR-001)
- [ ] Optional: RDF / ifcOWL / BOT alignment layer for semantic interoperability

## Provisioning (cross-cutting — see INFRA.md checklist)
- [x] ClayOS Supabase project · [x] GitHub repo · [x] Cloudflare Pages project · [x] deploy (all live since session 1)
