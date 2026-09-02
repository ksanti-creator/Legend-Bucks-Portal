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

# Custom-denomination Legend Bucks gift cards and secure issuance records.
# Plaintext card codes are deliberately absent: only SHA-256 and last four exist.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS is_custom_gift_card boolean NOT NULL DEFAULT false;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS gift_card_increment_lb integer;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS gift_card_minimum_lb integer;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS gift_card_maximum_lb integer;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS gift_card_lb_amount integer;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS gift_card_cad_value_cents integer;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS gift_card_recipient_name text;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS gift_card_recipient_email text;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS gift_card_message text;
DO $$ BEGIN
  CREATE TYPE gift_card_issue_status AS ENUM ('pending_issue','emailed','email_failed','voided','reissued');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS gift_card_issues (
  id serial PRIMARY KEY,
  redemption_id integer NOT NULL REFERENCES redemptions(id),
  code_hash text NOT NULL UNIQUE,
  code_last4 text NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  lb_amount integer NOT NULL,
  cad_value_cents integer NOT NULL,
  status gift_card_issue_status NOT NULL DEFAULT 'pending_issue',
  issued_by_employee_id integer NOT NULL REFERENCES employees(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  emailed_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  replacement_issue_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_issues_one_current_per_redemption
  ON gift_card_issues(redemption_id) WHERE status NOT IN ('voided','reissued');
SQL
fi

# Multi-photo rewards: add ordered photo list and backfill from the legacy
# single image column. Idempotent — safe to re-run.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
UPDATE rewards SET image_urls = ARRAY[image_url] WHERE image_url IS NOT NULL AND image_urls = '{}';
CREATE TABLE IF NOT EXISTS reward_sizes (
  id serial PRIMARY KEY,
  reward_id integer NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  label text NOT NULL,
  quantity integer,
  sort_order integer NOT NULL DEFAULT 0
);
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS size_label text;
CREATE UNIQUE INDEX IF NOT EXISTS reward_sizes_reward_id_label_unique ON reward_sizes (reward_id, label);
SQL
fi

# Payroll approval step for Time Off redemptions: new redemption status.
# ALTER TYPE ... ADD VALUE cannot run inside a transaction, so it gets its own
# psql -c call. Idempotent via IF NOT EXISTS.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER TYPE redemption_status ADD VALUE IF NOT EXISTS 'pending_payroll' AFTER 'approved';"
fi

# Admin balance adjustments: track who recorded a ledger entry. Idempotent.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_by_id integer;"
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
