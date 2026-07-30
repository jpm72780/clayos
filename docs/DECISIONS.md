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
"now", so history is synthesised in the seed. Re-seed is reproducible, not truly irreversible (old
generator is in git history).
**Cloud status:** APPLIED 2026-06-29 via `scripts/reseed-cloud.sh` (user-authorised). Live cloud now
has 8 projects / 1,711 entities / 318 history rows / embeddings drained. Re-run that script to refresh.
(Autonomous cloud rebuild was blocked by the safety classifier overnight; ran it on explicit "you run it".)

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

## ADR-012 — Agent answers stream over SSE (tool progress + token deltas)
**Status:** Accepted (2026-06-29, session 4 — external review #3)
**Context:** The agent is a multi-turn (≤24) tool loop; the UI showed a static "analyzing…" for the full
12–15s and rendered the final answer all at once. The review asked to stream tokens, show a typing
indicator, and surface what the agent is doing.
**Decision:** `agent-ask` content-negotiates: `Accept: text/event-stream` → an SSE stream that emits a
`tool` event (with a friendly label) as each kg_* call runs, `token` events from a streamed final
Anthropic call, and a terminal `done` event with `{focus,highlight,tool_calls}`. The `@@VIEW@@` view-
control marker is **tail-buffered server-side** so it never appears in the visible token stream, then
parsed for the `done` payload. Without that header the original **blocking JSON** path is unchanged
(used by `evals/`). The client (`api.js#askStream`) parses SSE and **falls back** to reading a whole
JSON body if the response isn't `text/event-stream` (old function / a proxy that collapses the stream),
so chat can never regress below today's behavior.
**Rationale:** Real perceived-latency win + grounding visibility, with zero risk to the eval contract or
to clients behind buffering proxies. Streaming only the final turn (and narrating tool steps) keeps the
loop logic simple while giving live feedback throughout.
**Trade-offs:** intermediate "let me check…" narration from a tool-turn can briefly precede the final
answer in the same bubble (usually tool-only turns have no text, so this is rare and reads naturally).

## ADR-014 — Client-side pagination for the 1,000-row PostgREST cap (RPCs need ?limit/?offset)
**Status:** Accepted (2026-06-29, session 4 — latent bug B1)
**Context:** PostgREST caps every response at 1,000 rows (`db-max-rows`). The graph is 1,711 entities, so
`allEntities` (Data table + quantification + CSV), `entityClassMap` (3D highlight) and `entityFacts`
(flow/$) were silently returning only the first 1,000 — invisible from outside the app.
**Decision:** Page on the client in `api.js`. **Table reads honor the `Range` header**, so `fetchAllRows`
loops `.range(from,to)` with a deterministic `.order()` (a secondary key, or pages overlap). **The SETOF
RPC `kg_entity_facts` IGNORES the Range header** but honors `?limit`/`?offset` query params — verified by
curl — so `fetchAllRpc` pages those via direct `fetch` to `/rest/v1/rpc/...` (with `Accept-Profile:
clayos`). Both have a 50-page safety cap so a server that ignores paging can't infinite-loop.
**Rationale:** No schema/RPC change; the whole dataset reaches the UI. The Range-vs-limit/offset split is
the non-obvious part — `supabase-js .range()` sends a Range header that the RPC drops, which would loop
on duplicate first pages. **Future:** if the dataset grows large, raise `db-max-rows` or add server-side
keyset pagination instead of fetching everything.

## ADR-013 — Disable node-drag in Lifecycle 3D (fixes the `reading 'x'` crash)
**Status:** Accepted (2026-06-29, session 4 — external review #1)
**Context:** The 3D view threw repeated `TypeError: Cannot read properties of undefined (reading 'x')`
on interaction. Reproduced via CDP: `OrbitControls.onPointerUp` has a `case 1:` branch that reads
`this._pointerPositions[pointerId].x` for an untracked pointer; it's reached because, when a node **drag**
ends, 3d-force-graph dispatches a synthetic `pointerup` ("ensure the controls don't take over after
dragend") that OrbitControls processes against a pointer it never recorded.
**Decision:** `.enableNodeDrag(false)` on the ForceGraph3D instance. This skips DragControls creation
entirely, removing the DragControls→OrbitControls pointer hand-off that crashes.
**Rationale:** Every node is pinned (`fx/fy/fz`) and the camera is orbit-driven — node dragging was
never wired (no `onNodeDrag`/`onNodeDragEnd`) and fights the deterministic layout. Disabling it is the
minimal, intent-aligned fix; node clicks and camera orbit/pan/zoom are unaffected. Verified 0 exceptions
across aggressive drags / sliders / highlight changes / business-unit rebuilds / resize.

## ADR-015 — Portfolio map: static client-side geocoding, no schema change
**Status:** Accepted (2026-07-30, session 13)
**Context:** John asked to replace the 2D story with an interactive US/world map showing all
projects. Projects already carry real `city`/`state` (deep projects hand-placed, light ones drawn
from `seed/generate.py CITIES`, 47 distinct cities), but no lat/lng column exists.
**Decision:** Plot via a static `app/src/lib/geo.js` lookup (city → [lon,lat], state-centroid
fallback) instead of adding lat/lng columns + reseeding. Basemap is TopoJSON (`world-atlas`
countries-110m + `us-atlas` states-10m) rendered with d3-geo — no tile servers or map API keys.
**Rationale:** The city list is finite, seed-controlled, and byte-stable — a migration + reseed
(TRUNCATE + full embed re-drain, ~2-3 min + API cost, plus RNG-ordering risk to the goldens) buys
nothing over a 50-line lookup. Self-contained TopoJSON keeps the app deployable as pure static
files (Cloudflare Pages, CSP-friendly, offline demos) and visually consistent with the dark theme,
which real tile providers (OSM policy, CARTO licensing, key management) complicate. **Future:** if
projects ever get per-site addresses (Snowflake track), add real lat/lng columns there and bypass
the lookup; the map reads coordinates through one `coordsFor()` seam.
