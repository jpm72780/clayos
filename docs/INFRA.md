# ClayOS — Infrastructure & Credentials Map

> **Living document.** Pointers only — **never** paste secret values here. Update when a
> resource is provisioned (add refs/URLs). All real secrets live in the secrets file below.

## Secrets

- **File:** `/home/clawd/.config/secrets.env` (sourced by deploy scripts; NOT in any repo).
- Relevant env var names already present: `SUPABASE_*` (orgmapai), `HUNTDATA_SUPABASE_*` (AECOM),
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY` (live, in prod — do not
  rotate without a migration plan), `OPENAI_API_KEY` (for embeddings), `N8N_API_KEY`, `GITHUB_TOKEN`.
- **ClayOS will add:** `CLAYOS_SUPABASE_URL`, `CLAYOS_SUPABASE_ANON_KEY`,
  `CLAYOS_SUPABASE_SERVICE_ROLE_KEY`, `CLAYOS_SUPABASE_PROJECT_REF` once provisioned.

## Supabase

- **ClayOS project:** ✅ PROVISIONED 2026-06-27. `project_ref` = **`fwaydsjpudusbaeyccjc`**, region
  us-east-2, Postgres 17. URL `https://fwaydsjpudusbaeyccjc.supabase.co`. Schema `clayos` (exposed to
  PostgREST via management API: `db_schema = "public, clayos, graphql_public"`). All keys + DB
  password in `/home/clawd/.config/clayos.env` (CLAYOS_SUPABASE_*, CLAYOS_DB_PASS,
  CLAYOS_DB_SESSION_DSN on pooler host `aws-1-us-east-2.pooler.supabase.com:5432`).
  - Migrations 001-009 applied; seed loaded (750 entities / 1004 edges); all 750 embedded.
  - Edge functions deployed: `agent-ask`, `embed-entities` (function secrets CLAUDE_API_KEY,
    OPENAI_API_KEY set). Endpoints: `https://fwaydsjpudusbaeyccjc.supabase.co/functions/v1/{name}`.
  - Apply more migrations via: `docker exec -i clayos_db psql "$CLAYOS_DB_SESSION_DSN" < file.sql`.
- Existing (for reference, do NOT reuse): orgmapai `dxnigbhojoxjmcltgeoy` (schema `counterpart`);
  HuntData `batrpibfwldphamnaamv` (AECOM field data, reached via n8n SQL-executor webhook).
- Extensions needed: `ltree`, `vector` (pgvector), `pg_trgm`, `pg_cron`, `pg_net`. (orgmapai proves
  all are available on this Supabase plan.)
- Embeddings: 1536-dim (OpenAI text-embedding-3-small) to match the HNSW index.

## Cloudflare

- **Account ID:** `de7697d25ef5d3238937acc9262fda76`. Token: `CLOUDFLARE_API_TOKEN` (scoped for Pages).
- **ClayOS Pages project:** ✅ CREATED 2026-06-27. Project `clayos`, production branch `main`.
  **Live: https://clayos.pages.dev**. Deployed directly via `npx wrangler pages deploy app/dist
  --project-name=clayos`. (Build env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY baked into the bundle.)
- ⚠️ wrangler rejects unicode in commit titles — keep commit messages ASCII.
- Existing for reference: `orgmapai` Pages project (orgmapai.com).

## GitHub

- ✅ **github.com/jpm72780/clayos** (private), pushed 2026-06-27 on `main`.
- ⚠️ Auth note: the **`gh` OAuth token** (scopes gist/read:org/repo) pushes code but **lacks `workflow`
  scope** — can't push `.github/workflows/*`. The **fine-grained PAT** (`GITHUB_TOKEN`) has **no access to
  this new repo** (scoped to orgmapai). So: the Actions workflow is parked at
  `docs/deploy/github-actions-deploy.yml`, and Actions secrets weren't set (public-key endpoint 404 —
  needs admin/Actions enabled). To enable CI: use a `workflow`-scoped token, move the file into
  `.github/workflows/`, and set the 4 repo secrets. Push from here with: `gh auth token` in the remote URL.

## n8n (future — ingestion only)

- Cloud: `https://xj5x.app.n8n.cloud` (API key `N8N_API_KEY`). Self-hosted on VPS via Traefik.
- Pattern to reuse later: HTTP webhook → Postgres node (like the existing "SQL Executor" webhook).
- ⚠️ API-created workflows can't resolve UI-created credentials — build workflows in the UI.
- Not needed for the POC (synthetic seed). Wire real connectors (Procore/ACC/ERP) in Phase 4.

## VPS (Hostinger)

- Ubuntu 22.04, 2 cores, ~4GB RAM (3.6 used), 62GB disk free. Docker active (Traefik, n8n, MinIO).
- Spare capacity OK for local pgvector PG. Keep heavy state on Supabase, not the VPS.
- Existing OrgMapAI runner daemon runs here (don't disturb).

## Local development

- `docker-compose.yml` → `pgvector/pgvector:pg16`, host port **54329**.
- `CLAYOS_DSN` default: `postgresql://clayos:clayos@localhost:54329/clayos`.
- `scripts/db.sh {up|down|reset|migrate|psql}`.

## Provisioning checklist (when ready to go cloud)

- [ ] Create ClayOS Supabase project; enable extensions; record ref/URL; add keys to secrets.env.
- [ ] `supabase db push` migrations 001-009.
- [ ] Deploy edge functions `agent-ask`, `embed-entities`; set function env (ANTHROPIC, OPENAI keys).
- [ ] Create GitHub repo; push; add Actions secrets (CF token/account, Supabase keys).
- [ ] Create Cloudflare Pages project `clayos`; first `wrangler pages deploy`.
