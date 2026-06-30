#!/usr/bin/env bash
# Re-seed the LIVE cloud Supabase DB with the current synthetic seed
# (CRG dev arm, deeper projects, 12-month trend history).
#
# This is intentionally NOT run autonomously — it replaces the live demo data
# (the seed self-cleans via TRUNCATE, schema/functions/grants are preserved).
# Run it yourself when ready:   ./scripts/reseed-cloud.sh
#
# Verified end-to-end on local Postgres already (6 BUs, 8 projects, ~1,711 entities).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source /home/clawd/.config/clayos.env
DSN="$CLAYOS_DB_SESSION_DSN"; U="$CLAYOS_SUPABASE_URL"; SR="$CLAYOS_SUPABASE_SERVICE_ROLE_KEY"

echo "1/4  Generating deterministic seed…"
python3 seed/generate.py > /tmp/clayos_seed.sql
echo "     $(wc -l < /tmp/clayos_seed.sql) lines"

echo "2/4  Loading into cloud (TRUNCATE + insert; schema unchanged)…"
docker exec -i clayos_db psql "$DSN" -q -v ON_ERROR_STOP=1 < /tmp/clayos_seed.sql
docker exec -i clayos_db psql "$DSN" -c "NOTIFY pgrst, 'reload schema';" >/dev/null

echo "3/4  Draining entity embeddings (powers semantic search / the agent)…"
for _ in $(seq 1 80); do
  left=$(docker exec -i clayos_db psql "$DSN" -At -c "SELECT count(*) FROM clayos.graph_embed_jobs;")
  echo "     embed jobs remaining: $left"
  [ "$left" = "0" ] && break
  curl -s -X POST "$U/functions/v1/embed-entities" \
       -H "Authorization: Bearer $SR" -H "Content-Type: application/json" -d '{}' >/dev/null || true
  sleep 2
done

echo "4/4  Verify:"
docker exec -i clayos_db psql "$DSN" -At -c \
  "SELECT 'projects='||count(*) FROM clayos.projects;
   SELECT 'entities='||count(*) FROM clayos.entities;
   SELECT 'kpi_history='||count(*) FROM clayos.kpi_history;
   SELECT 'business_units='||string_agg(slug,',' ORDER BY slug) FROM clayos.business_units;"
echo "Done — refresh https://clayos.pages.dev (CRG projects, deeper data, trend charts)."
