#!/usr/bin/env bash
# Runs the migrations + database tests against a SCRATCH PostgreSQL database.
#   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch ./tests/db/run.sh
# WARNING: the scratch database is modified (tables are truncated). Never point this at production.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?Set DATABASE_URL to an empty scratch database}"
psql_() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }
psql_ -f tests/db/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "applying $f"; psql_ -f "$f" >/dev/null; done
# migrations must be re-runnable
for f in supabase/migrations/*.sql; do psql_ -f "$f" >/dev/null; done
echo "migrations applied twice without errors"
psql_ -f tests/db/10_security_and_logic.sql 2>&1 | grep -E "PASS|FAIL|ERROR|ALL DATABASE" 
psql_ -f tests/db/20_photos_rooms.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
