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

## ADR-009 — `kg_query` text-to-SQL via a SECURITY DEFINER fn owned by clayos_readonly
**Status:** Accepted (2026-06-28)
**Context:** The agent needed ad-hoc aggregates beyond the curated kg_* tools, without a write path.
**Decision:** `clayos.kg_query_safe(text)` (migration 011): validates SELECT/WITH-only + single
statement + forbidden-keyword backstop, runs with a 5s timeout + 500-row cap, and is **owned by the
low-privilege `clayos_readonly` role** (SECURITY DEFINER) so it can only read the clayos schema.
**Rationale:** `SET ROLE` is illegal inside SECURITY DEFINER, so privilege reduction is achieved by
*ownership* instead — a crafted `auth.*`/`pg_authid` read fails with permission denied. Owning an
object requires CREATE on the schema, so clayos_readonly is granted CREATE (harmless: NOLOGIN, used
only as this fn's definer). Verified writes/multi-statement/sensitive reads are all rejected.

## ADR-010 — Data expansion: CRG dev arm + deepen all + synthetic trend history
**Status:** Accepted (2026-06-28, user-requested)
**Context:** User wanted more data, incl. Clayco's development arm (CRG). Original seed had 2 of 6
projects deep and no time-series.
**Decision:** Add CRG (real_estate BU) with two CRG-branded synthetic projects; deepen all projects;
gate field-activity entities (daily logs/safety/quality) by lifecycle stage for realism; backfill
12 monthly `kpi_history` snapshots/project for trend charts. Determinism preserved (seed 42 + uuid5).
**Rationale:** Richer, more realistic demo across all five layers. `snapshot_kpis()` only captures
"now", so history is synthesised in the seed. **Cloud apply is gated** (safety system blocks
autonomous prod rebuild) → `scripts/reseed-cloud.sh` for the user. Re-seed is reproducible, not
truly irreversible (old generator is in git history).

## ADR-011 — RLS role-scoping shipped as inert scaffolding (not enforced)
**Status:** Accepted (2026-06-28)
**Context:** Multi-tenant credibility wants field-vs-exec scoping, but the live app reads via the anon
key — enabling RLS naively would blank it.
**Decision:** Migration 012 creates `clayos_field`/`clayos_exec` roles + `app_role()`/`app_bu()` JWT-claim
helpers and documents the enable-path, but does **not** enable RLS on any table.
**Rationale:** Ships the design without risking the live demo; enabling enforcement is a deliberate,
verified follow-up.

## ADR-008 — Ontology UX = single linked-selection 3D "vascular" workspace
**Status:** Accepted (2026-06-28, user-directed)
**Context:** The original UI was three disconnected tabs (Ontology/Reporting/Ask) over a Sigma
force-graph. User wants a Palantir-AIP / OrgMap-style single interface where the ontology is the
centerpiece and "tells a story by looking at it," feels like "flying around interwoven vascular
systems," and where selection drives everything.
**Decision:** Build a `3d-force-graph`(+three) **Lifecycle 3D** view as the default ontology mode:
projects = floating globe-clusters along a lifecycle-into-depth axis, thin vessels with flowing
particles = recently-moved data points, bloom/fog/auto-orbit. **Selection is the universal filter** —
clicking a project rescopes a docked KPI strip + the docked agent. Cross-cutting standards/vendor/
employee keys are highlight filters. Kept the 2D "story" (SVG) and original Sigma "Network" as
alternate modes. Per-entity facts (activity date, $ amount) for the flow come from a read-only
`kg_entity_facts()` RPC (migration 010) over domain semantic dates — `entities.updated_at` is all
seed-time so it can't drive recency.
**Rationale:** Matches the approved 5-layer vision (ontology→reporting→KPI→agent) as one surface
instead of tabs; the 3D/vascular metaphor makes data concentration + cross-system flow legible at a
glance. Force-graph fixes node positions (deterministic layout) yet keeps every edge connected.
**Trade-offs:** +~1.4 MB lazy 3D chunk; WebGL/bloom cost; flow recency is synthetic-but-real (derived
from seed dates). Revisit if node counts grow past ~5k (LOD/expand-on-demand).
