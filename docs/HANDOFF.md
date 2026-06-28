# ClayOS — Handoff (read this first)

> **Living document.** Update the "Current snapshot" + "Next actions" sections at the
> end of every working session. This is the single entry point for resuming work.

**Last updated:** 2026-06-28 (session 2 — unified 3D "vascular" ontology interface, live)
**Updated by:** Claude (Opus 4.8) session — Phase 1 LIVE & verified; session 2 reshaped the ontology UX
**Repo:** `/home/clawd/projects/clayos` → pushed to **github.com/jpm72780/clayos** (private, `main`)
**Live app:** **https://clayos.pages.dev** (HTTP 200)

---

## What this is

ClayOS is a **company operating system POC** for a large design-build firm (modeled on
**Clayco**). Five layers, roadmap order: (1) knowledge-graph ontology viewer, (2) reporting
by business unit, (3) KPI/metrics, (4) agentic natural-language Q&A, (5) app/workflow builder.
Full vision, rationale, and the approved plan: see **`docs/ARCHITECTURE.md`** and the canonical
plan file at `/home/clawd/.claude/plans/lets-create-a-new-breezy-curry.md`.

**Core architectural decision:** the knowledge graph is **Postgres-native** (no Neo4j).
Per-domain relational tables are the system of record; a generic `entities`/`edges` projection
(kept in sync by triggers) feeds the viewer + agent. See `docs/DECISIONS.md` ADR-001.

**Confirmed scope (user-approved):** synthetic seed data · thin slice through all 5 layers ·
new repo + new Supabase project · Postgres-native graph · depth-first (3 BUs, 5-6 projects).

---

## Current snapshot — where we are RIGHT NOW

**Phase:** Phase 1 complete & live. **Session 2 = ontology UX overhaul** toward a single
Palantir/OrgMap-style **linked-selection workspace** (user direction: "one interface for everything").

**Session-2 frontend state (all live at https://clayos.pages.dev → Ontology tab):**
- **Three ontology modes** (toggle in the Ontology tab header): **Lifecycle 3D** (default) · **2D story** · **Network** (the original Sigma graph).
- **Lifecycle 3D** = the centerpiece. Projects are **floating "vascular" globe-clusters** in 3D (x=lifecycle receding into depth, sized by data, tinted by business unit, faint membrane), connected by **thin vessels** with **flowing cyan particles = data points that "moved" in a time window**. Bloom + depth fog + drifting auto-orbit camera. Built on `3d-force-graph` + `three` + `three-spritetext` (added deps; lazy-loaded chunk).
- **Selection drives everything (the unification):** click a project globe → the docked **KPI strip** (bottom) rescopes to that project (CPI/SPI/EAC/RFIs/TRIR from the matviews) and the docked **Ask** box pre-loads its context. "↩ enterprise" resets.
- **Cross-cutting "Highlight by" rail:** MasterFormat (CSI) · UniFormat · Vendor · Employee — highlights that key across **every** project at once (highlight, don't remove). Backed by `classification_codes` + `entities.classification_id` (read via PostgREST, no schema change).
- **Flow controls panel:** time-window (1h→30d) · speed · size sliders; live "N moved" count.
- New frontend files: `app/src/views/Lifecycle3DView.jsx` (3D), `app/src/views/LifecycleView.jsx` (2D), plus `App.jsx`/`api.js` wiring.

*(Original Phase-1 snapshot below still holds — backend/agent/data unchanged this session.)*

**Phase 1 (vertical slice):** **COMPLETE & DEPLOYED LIVE.** All five layers demoable end-to-end.

**Live system (all working):**
- **App:** https://clayos.pages.dev (Cloudflare Pages) — Ontology viewer (Sigma), Reporting (Recharts), Ask ClayOS (chat).
- **Supabase:** project `fwaydsjpudusbaeyccjc` — schema + seed + 750 embeddings loaded; `clayos` schema exposed to PostgREST.
- **Edge functions:** `agent-ask` (Claude `opus-4-8` tool-loop) + `embed-entities`, deployed with secrets set.
- **Agent verified end-to-end on 2 question types** (against live cloud):
  - "Which Clayco Compute projects are over budget and why" → Aurora CPI 0.91 / SPI 0.839 / EAC $396.9M (cited).
  - "Which project has the worst safety record" → Aurora TRIR 9.27 vs Cedar Rapids 4.38 (correct comparison table).
  - Routes through kg_kpi/kg_search/kg_traverse/kg_get_entity; numbers come from KPI matviews (no hallucination).
- **Code:** github.com/jpm72780/clayos (`main`). Frontend data paths confirmed via anon PostgREST.

**Known caveats / not done:**
- **CI auto-deploy NOT enabled.** The Actions workflow is parked at `docs/deploy/github-actions-deploy.yml`
  (the available gh token lacks `workflow` scope; the fine-grained PAT has no access to this repo). To deploy
  now: `cd app && npm run build && npx wrangler pages deploy dist --project-name=clayos`. To enable CI: add
  the file to `.github/workflows/` with a `workflow`-scoped token and set repo secrets (CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY — anon key is public-safe).
- **Frontend not yet visually verified in a browser** (build + all data paths via anon PostgREST confirmed; no screenshot taken).
- **pg_cron not enabled** on the cloud project (migration 009 no-op'd). KPI matviews are fresh from seed but
  won't auto-refresh until pg_cron is enabled + `refresh_all_kpis()` scheduled.
- RLS role-scoping and text-to-SQL (`kg_query`) deferred to Phase 2 (see ROADMAP).

---

### (historical) Phase 0 — Foundation — COMPLETE & verified on local Postgres.

**Done:**
- Repo scaffolded: `README.md`, `.gitignore`, `docker-compose.yml` (local pgvector PG on port
  **54329**), `scripts/db.sh` (up/down/reset/migrate/psql helper).
- **All 9 migrations written and applying clean** on local PG (`001`-`009`): extensions+helpers,
  classification, business_units, 35 domain tables, entities/edges graph + RPCs, projection
  triggers + embed queue + `kg_reproject_all()`, 8 KPI matviews + rollup + history, grants +
  `clayos_readonly` role, pg_cron (guarded → no-op locally).
- **Seed generator `seed/generate.py`** — deterministic, emits one SQL transaction (driver-free).
  Loaded: 3 BUs + service group, 6 projects (2 deep: DC-001 Aurora, DC-002 Cedar Rapids),
  **750 entities / 1004 edges / 750 embed jobs**.
- **Phase 0 exit criteria met & verified:**
  - EVM known-good: Aurora SPI **0.84** / CPI **0.91** (behind+over, EAC>BAC); Cedar Rapids
    SPI **1.04** / CPI **1.06** (healthy).
  - WIP: Aurora overbilled +$17.5M; Cedar Rapids underbilled −$11.3M.
  - Safety TRIR: Aurora 9.27 vs Cedar Rapids 4.38.
  - `kg_traverse` cross-domain works (Aurora reaches 255 entities @ 2 hops); `kg_subgraph`
    (Compute BU = 528 nodes/709 edges); `kg_bu_rollup` ltree rollup correct ($1.79B enterprise).
  - `kg_project_kpis` accepts both entity-id and domain-id.

**Local DB state:** container `clayos_db` is UP with all migrations + seed loaded. To rebuild from
scratch: `docker exec -i clayos_db psql -U clayos -d clayos -c "DROP SCHEMA clayos CASCADE"` then
re-run all migrations + `python3 seed/generate.py | docker exec -i clayos_db psql -U clayos -d clayos`.
(Note: `scripts/db.sh reset` can't delete `.pgdata` — it's owned by the container's postgres uid;
use the DROP SCHEMA path instead.)

*(The Phase-0 note above was written before cloud provisioning. Superseded by the Current snapshot:
cloud infra is now provisioned, seeded, embedded, and deployed.)*

---

## Flow enrichment — DONE (2026-06-28, session 2 cont.) ✓ live
1. ✓ **Flow means more** — pulse **colour by domain/type** (what moved), **speed by recency**, **hub pulse**
   (each project breathes brighter the more it moved in-window). 
2. ✓ **Real recency** — flow window driven by *actual* record dates via **migration 010 `kg_entity_facts()`**
   (`entities.updated_at` is all seed-time → recency comes from domain semantic dates). Verified vs DB:
   7d→5, 30d→49, all→459 data points moved. Migration applied to **local + cloud**; RPC anon-readable.
3. ✓ **Vessel thickness by $** — log-scaled width from `kg_entity_facts().amount` (contracts.value,
   cost_accounts.bac, pay_apps via lines, estimates/pursuits, projects.contract_value).

## Next actions
- **Deepen the unification**: make the "Highlight by" filters also **rescope the KPI strip** (e.g. pick a CSI
  division → portfolio cost rolled up by it); let the **agent drive the view** (answer → highlight/focus the
  relevant systems). 
- Then: original Phase-2 backlog below (text-to-SQL `kg_query`, RLS scoping, CI/pg_cron, deeper seed).

## Backlog (original Phase 2 — widen + deepen)

1. **Visually verify the UI** in a browser (or the /run skill): open https://clayos.pages.dev — confirm
   the Sigma graph renders + drill-down works, dashboards render, chat answers. Fix any runtime issues.
2. **Enable CI auto-deploy** (optional): move `docs/deploy/github-actions-deploy.yml` →
   `.github/workflows/deploy.yml` using a `workflow`-scoped token; set the 4 repo secrets.
3. **Enable pg_cron** on the cloud project + reschedule `refresh_all_kpis()` / `snapshot_kpis()` /
   `kg_reproject_all()` (migration 009 patterns; enable the extension first).
4. **`kg_query` text-to-SQL** tool with the safety harness (clayos_readonly role, single-SELECT
   validation, statement_timeout) — currently NOT in the tool registry.
5. **RLS scoping** by role (field user vs exec) + per-turn world-state tuning.
6. Deepen seed coverage (WIP/backlog/utilization dashboards, kpi_history trend charts).

## How to deploy right now (no CI)
- **Frontend:** `cd app && npm run build && npx wrangler pages deploy dist --project-name=clayos`
  (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from secrets.env).
- **DB migration:** `docker exec -i clayos_db psql "$CLAYOS_DB_SESSION_DSN" < migrations/NNN.sql`
  (source `/home/clawd/.config/clayos.env` first).
- **Edge function:** `supabase functions deploy <name> --project-ref fwaydsjpudusbaeyccjc --no-verify-jwt`.

---

## How to resume in a fresh session

1. Read this file, then `docs/ARCHITECTURE.md` (design) and `docs/ROADMAP.md` (phase checklist).
2. Skim `docs/PROGRESS_LOG.md` for what happened last and `docs/DECISIONS.md` for why.
3. `docs/INFRA.md` has all infra/credential pointers (Supabase, Cloudflare, n8n, secrets, VPS).
4. Reusable source patterns live in the sibling repo `/home/clawd/projects/counterpart`
   (OrgMapAI). Key files to copy/adapt are listed in `docs/ARCHITECTURE.md` §"Reuse map".
5. Pick up at "Next actions" above.

## Maintenance convention

At the end of each session, the working agent MUST:
- Update **this file's** "Current snapshot" + "Next actions" + the Last-updated line.
- Append a dated entry to **`docs/PROGRESS_LOG.md`**.
- Tick/maintain checkboxes in **`docs/ROADMAP.md`**.
- Add an ADR to **`docs/DECISIONS.md`** for any non-obvious decision made.
- Update **`docs/INFRA.md`** if any project/resource was provisioned (refs, URLs — never secrets).
