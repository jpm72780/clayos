#!/usr/bin/env bash
# Local DB helper for ClayOS. Wraps docker-compose + psql against the local
# pgvector Postgres. Usage: scripts/db.sh {up|down|reset|migrate|seed|psql ...}
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSN="${CLAYOS_DSN:-postgresql://clayos:clayos@localhost:54329/clayos}"
PSQL_IN_CONTAINER=(docker exec -i clayos_db psql -U clayos -d clayos -v ON_ERROR_STOP=1)

case "${1:-}" in
  up)
    docker compose -f "$ROOT/docker-compose.yml" up -d
    echo "waiting for healthy db..."
    for i in $(seq 1 30); do
      if docker exec clayos_db pg_isready -U clayos -d clayos >/dev/null 2>&1; then
        echo "db ready on localhost:54329"; exit 0
      fi
      sleep 2
    done
    echo "db did not become ready" >&2; exit 1
    ;;
  down)
    docker compose -f "$ROOT/docker-compose.yml" down
    ;;
  reset)
    docker compose -f "$ROOT/docker-compose.yml" down -v
    rm -rf "$ROOT/.pgdata"
    "$0" up
    ;;
  migrate)
    for f in "$ROOT"/migrations/*.sql; do
      echo "── applying $(basename "$f")"
      "${PSQL_IN_CONTAINER[@]}" < "$f"
    done
    echo "migrations applied"
    ;;
  psql)
    shift
    "${PSQL_IN_CONTAINER[@]}" "$@"
    ;;
  *)
    echo "usage: $0 {up|down|reset|migrate|psql ...}" >&2
    exit 1
    ;;
esac
