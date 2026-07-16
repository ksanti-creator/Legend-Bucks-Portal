#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Schema migration for the manager-award-budget redesign, applied as explicit
# idempotent SQL. We do this instead of relying solely on `drizzle-kit push`
# because push resolves table/column/enum renames via INTERACTIVE prompts (even
# with --force) — which hang in the non-interactive post-merge environment. By
# transforming the schema here first, the later `push` sees no ambiguous diff.
# Every statement is guarded so re-running on an already-migrated DB is a no-op.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- Retire the team-budget model: drop its table and any transactions using the
-- retired `team_goal_award` type (must happen before recreating the enum).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions') THEN
    DELETE FROM transactions WHERE type::text = 'team_goal_award';
  END IF;
END $$;
DROP TABLE IF EXISTS team_budgets;

-- Replace the per-recipient award cap with a per-user yearly award budget.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS award_budget_yearly integer;
ALTER TABLE employees DROP COLUMN IF EXISTS award_cap_yearly;

-- Key/value store for global settings (e.g. max_single_award).
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Remove `team_goal_award` from the transaction_type enum by recreating it.
-- Guarded so it only runs while the retired value is still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'transaction_type' AND e.enumlabel = 'team_goal_award'
  ) THEN
    ALTER TYPE transaction_type RENAME TO transaction_type_old;
    CREATE TYPE transaction_type AS ENUM('award','redemption_debit','refund','contribution','adjustment');
    ALTER TABLE transactions ALTER COLUMN type TYPE transaction_type USING type::text::transaction_type;
    DROP TYPE transaction_type_old;
  END IF;
END $$;
COMMIT;
SQL
fi

# Reconcile anything else with the Drizzle schema. After the SQL above there is
# no ambiguous rename left, so push runs cleanly and non-interactively.
pnpm --filter db push-force

# Backfills — all idempotent, safe to run on every merge.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  # Link legacy goals (free-text `department`) to a real `department_id` by
  # case-insensitive department-name match. Only fills rows still unlinked.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE goals SET department_id = d.id FROM departments d WHERE goals.department_id IS NULL AND goals.department IS NOT NULL AND lower(trim(goals.department)) = lower(trim(d.name));"

  # Give existing admins/managers a sensible default yearly award budget so they
  # can award right away. Only fills accounts that have no budget set yet.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE employees SET award_budget_yearly = 50000 WHERE award_budget_yearly IS NULL AND role IN ('admin','manager');"

  # Seed the global maximum single award so the safeguard is active out of the
  # box. Only inserts when the setting is not already present.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO app_settings (key, value) VALUES ('max_single_award', '10000') ON CONFLICT (key) DO NOTHING;"
fi
