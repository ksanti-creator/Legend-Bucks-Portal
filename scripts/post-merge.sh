#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Backfill: link legacy goals (free-text `department`) to a real `department_id`
# by case-insensitive department-name match. Idempotent — only fills rows that
# are still unlinked, so it is safe to run on every merge.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE goals SET department_id = d.id FROM departments d WHERE goals.department_id IS NULL AND goals.department IS NOT NULL AND lower(trim(goals.department)) = lower(trim(d.name));"
fi
