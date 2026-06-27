# ClayOS — Decision Log (ADRs)

> **Living document.** Append a numbered ADR whenever a non-obvious decision is made.
> Format: Context · Decision · Rationale · Status. Mark superseded ADRs, don't delete.

---

## ADR-001 — Knowledge graph is Postgres-native (no Neo4j) for the POC
**Status:** Accepted (2026-06-27)
**Context:** Domain research recommended a property-graph DB (Neo4j) with optional RDF alignment.
The reusable chassis (OrgMapAI) is all-Postgres/Supabase. VPS is 4GB/2-core, already running
Docker+MinIO+n8n.
**Decision:** Model the graph in Postgres: generic `entities`+`edges` tables, JSONB properties,
`ltree` for strict hierarchies, recursive CTEs for traversal, pgvector for semantic search.
**Rationale:** Avoids a second datastore/auth/RLS/backup/ETL surface; keeps RLS-based
multi-tenancy; POC graph is low-thousands of nodes (CTEs are fast enough). Clean migration path to
Apache AGE (in-Postgres openCypher) or Neo4j later if traversal perf demands it. Revisit at Phase 4.

## ADR-002 — Per-domain tables are the system of record; graph is a projection
**Status:** Accepted (2026-06-27)
**Context:** Choice between a generic-graph-only model, relational-only, or both.
**Decision:** Both. Per-domain relational tables (real FKs/constraints) are authoritative and feed
KPIs directly. `entities`/`edges` is a denormalized projection (triggers + `kg_reproject_all()`)
consumed only by the viewer + agent traversal — never authoritative.
**Rationale:** Keeps domain constraints + correct KPIs while giving uniform cross-domain traversal.
Graph is cheap to rebuild, so drift is recoverable.

## ADR-003 — New repo + new Supabase project (not extend counterpart)
**Status:** Accepted (2026-06-27, user-confirmed)
**Context:** Could extend the existing OrgMapAI/counterpart repo+schema or start clean.
**Decision:** New repo `/home/clawd/projects/clayos`, new Supabase project, schema `clayos`.
**Rationale:** Construction domain barely overlaps counterpart's (agents/tasks). Clean numbered
migrations > wrestling 130+ counterpart migrations. Copy ~6 patterns/files, not the database.

## ADR-004 — Synthetic, deterministic seed data for the POC
**Status:** Accepted (2026-06-27, user-confirmed)
**Context:** No live integrations (Procore/ERP/etc.) available; HuntData is AECOM's, not Clayco's.
**Decision:** Generate realistic Clayco-like data with a seeded RNG; optionally use the live Claude
key for narrative text (RFI bodies, daily logs). Connectors (n8n→Procore/ACC/ERP) are roadmap.
**Rationale:** Fastest path to demoing all five layers; designed so real connectors slot in later.

## ADR-005 — Ontology viewer: Sigma.js for the dense graph, React Flow for curated sub-views
**Status:** Accepted (2026-06-27)
**Context:** Knowledge graph will have thousands of nodes; React Flow (SVG/DOM) degrades past ~500-800.
**Decision:** Sigma.js + graphology (WebGL) for the "explore everything" canvas; reuse counterpart's
React Flow `OrgChart.jsx` for small curated views (a project's org/WBS). Server returns capped,
pre-filtered subgraphs; expand-neighborhood on click.
**Rationale:** WebGL scales to 10k+ nodes; curated tile UI still shines for small structured views.

## ADR-006 — Local pgvector Postgres in Docker for dev/verify before provisioning Supabase
**Status:** Accepted (2026-06-27)
**Context:** Want to verify migrations + seed + KPIs before touching cloud infra.
**Decision:** `docker-compose.yml` runs `pgvector/pgvector:pg16` on host port 54329. Migrations are
portable (extensions unqualified; pg_cron guarded). pg_cron is exercised only on Supabase.
**Rationale:** Fast iteration, no cloud cost/risk, catches schema bugs early. `CLAYOS_DSN` overridable.

## ADR-007 — Living handoff docs in `docs/`, updated every session
**Status:** Accepted (2026-06-27, user-requested)
**Context:** Work spans multiple sessions; need resumability.
**Decision:** Maintain HANDOFF, ARCHITECTURE, PROGRESS_LOG, DECISIONS, INFRA, ROADMAP in `docs/`.
Working agent updates them at end of each session (convention in HANDOFF.md).
