# ClayOS — Progress Log

> **Living document.** Append a dated entry at the end of each working session.
> Newest first. Keep entries short: what changed, what was verified, what's next.

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
