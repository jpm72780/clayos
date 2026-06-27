# ClayOS — Handoff (read this first)

> **Living document.** Update the "Current snapshot" + "Next actions" sections at the
> end of every working session. This is the single entry point for resuming work.

**Last updated:** 2026-06-27 (session 1, late)
**Updated by:** Claude (Opus 4.8) session — Phase 0 complete
**Repo:** `/home/clawd/projects/clayos` (not yet a git repo / not yet pushed)

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

**Phase:** Phase 0 (Foundation) — **COMPLETE & verified on local Postgres.** Ready for Phase 1.

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

**No cloud infra provisioned yet** — no ClayOS Supabase project, Cloudflare Pages, or GitHub repo.
Embeddings NOT yet generated (750 jobs queued; need OpenAI key + embed step → `kg_search` is dormant
until then). All credentials exist; see `docs/INFRA.md`.

---

## Next actions (Phase 1 — the demo slice)

1. **Embeddings:** write `seed/embed.py` (or deploy `embed-entities`) to drain `graph_embed_jobs`
   via OpenAI text-embedding-3-small (1536-d) so `kg_search` works. Key in secrets.env.
2. **Edge functions:** build `supabase/functions/_shared/kg_tools.ts` (kg_search/get_entity/
   traverse/kpi/schema) + `agent-ask/index.ts` (fork counterpart's 32-turn loop). Verify Claude
   model IDs via the claude-api skill first.
3. **Frontend:** scaffold Vite+React 19+Tailwind in `app/`; Supabase client; GraphView (Sigma.js),
   DashboardView (Recharts), AskView (chat → agent-ask).
4. **Provision:** create ClayOS Supabase project → `supabase db push` + seed; deploy functions;
   create GitHub repo + Cloudflare Pages; wire Actions deploy. See `docs/INFRA.md` checklist.
5. Phase 1 exit: open graph → click Aurora → SPI/CPI chart → ask agent "which Clayco Compute
   projects are over budget and why" → grounded, cited answer.

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
