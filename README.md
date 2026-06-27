# ClayOS — A Company Operating System for Clayco (POC)

> **Resuming work across sessions?** Start at **[`docs/HANDOFF.md`](docs/HANDOFF.md)** — it has
> the current state and next actions. Living docs: [HANDOFF](docs/HANDOFF.md) ·
> [ARCHITECTURE](docs/ARCHITECTURE.md) · [PROGRESS_LOG](docs/PROGRESS_LOG.md) ·
> [DECISIONS](docs/DECISIONS.md) · [INFRA](docs/INFRA.md) · [ROADMAP](docs/ROADMAP.md).

A unified data/ontology + reporting + agentic layer that sits on top of an entire
design-build firm (modeled on **Clayco**). Five layers, roadmap order:

1. **Ontology viewer / knowledge graph** — all company data, project and non-project, start to finish.
2. **Reporting layer** — quantifies all data, organized by business unit.
3. **KPI / metrics layer** — EVM (SPI/CPI), WIP, backlog, safety TRIR, utilization.
4. **Agentic layer** — any user can ask natural-language questions against the data.
5. **App / workflow builder** (roadmap) — scoped/controlled data access for tools.

Built on the proven OrgMapAI stack: **React 19 + Vite + Tailwind** (Cloudflare Pages),
**Supabase Postgres** (`ltree` + `pgvector` + `pg_cron`), and **Supabase Edge Functions**
running a Claude tool-use loop. POC data is **synthetic, deterministically generated**.

## Architecture at a glance

```
per-domain relational tables  ──(triggers)──▶  entities + edges  (generic graph projection)
   (system of record)                              │
   projects, wbs_nodes, cost_*,                     ├──▶ ontology viewer (Sigma.js)
   schedule_*, rfis, submittals,                    └──▶ agent kg_traverse / kg_search
   safety_events, pay_apps, persons,
   organizations, documents, ...        ──▶  KPI materialized views  ──▶ dashboards (Recharts)
                                                    └──▶ agent kg_kpi (grounded numbers)
```

- **Per-domain tables are the system of record** (real FKs/constraints; KPIs query them directly).
- **`entities`/`edges` is a denormalized projection** consumed only by the viewer + agent traversal.
- **Strict hierarchies** (business units, WBS, OmniClass/MasterFormat) use `ltree`.
- **Cross-domain mesh** (RFI → element → document → org) uses the property-graph `edges` table.

## Layout

```
migrations/        001_extensions … 009_cron   (numbered, forward-only SQL)
seed/              generate.py + data/ (OmniClass/MasterFormat CSVs)
supabase/functions/
  _shared/         embeddings.ts, kg_tools.ts, context.ts
  agent-ask/       Claude tool-use loop (fork of counterpart agent-step-claude)
  embed-entities/  drains graph_embed_jobs → writes entities.embedding
app/               React 19 + Vite + Tailwind frontend
scripts/           local dev helpers (db up/reset/migrate)
```

## Local development

```bash
# 1. start a local Postgres with pgvector (+ ltree, pg_trgm via contrib)
scripts/db.sh up

# 2. run migrations
scripts/db.sh migrate

# 3. seed synthetic Clayco data (loads classification CSVs, generates projects)
cd seed && pip install -r requirements.txt && python generate.py --dsn "$CLAYOS_DSN"

# 4. verify
scripts/db.sh psql -c "SELECT * FROM clayos.kg_bu_rollup;"

# 5. frontend
cd app && npm install && npm run dev
```

`CLAYOS_DSN` defaults to `postgresql://clayos:clayos@localhost:54329/clayos`.

## Deploy (Supabase + Cloudflare)

- Migrations: `supabase db push` against the ClayOS Supabase project.
- Edge functions: `supabase functions deploy agent-ask embed-entities`.
- Frontend: push to `main` → GitHub Actions runs `wrangler pages deploy` (Cloudflare Pages project `clayos`).

See `migrations/` headers and `seed/generate.py` for details. Status and roadmap tracked in the plan.
