-- Reviewed SQL reference for the Drizzle schema in src/schema/storeGiftCards.ts.
-- This is NOT an executable deployment hook or a production migration runner.
-- Replit applies the Drizzle development schema after task merge and computes
-- the managed production schema diff during Publish after the administrator's
-- checkout/reconciliation review. Never run this file against production.
--
-- No UPDATE/INSERT/backfill touches gift_card_issues. Existing emailed cards
-- open at their unchanged cad_value_cents face value: a card with zero
-- store_card_ledger rows has that exact balance until its first store spend.

CREATE TABLE stores (
  id serial PRIMARY KEY,
  name text NOT NULL,
  location_id integer NOT NULL REFERENCES locations(id),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE store_access (
  store_id integer NOT NULL REFERENCES stores(id),
  employee_id integer NOT NULL REFERENCES employees(id)
);
CREATE UNIQUE INDEX store_access_employee_store
  ON store_access (store_id, employee_id);

CREATE TABLE store_card_lookup_tokens (
  id serial PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  card_id integer NOT NULL REFERENCES gift_card_issues(id),
  store_id integer NOT NULL REFERENCES stores(id),
  employee_id integer NOT NULL REFERENCES employees(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX store_card_lookup_expires ON store_card_lookup_tokens (expires_at);

CREATE TABLE store_card_ledger (
  id serial PRIMARY KEY,
  transaction_ref text NOT NULL UNIQUE,
  card_id integer NOT NULL REFERENCES gift_card_issues(id),
  store_id integer NOT NULL REFERENCES stores(id),
  employee_id integer NOT NULL REFERENCES employees(id),
  kind text NOT NULL,
  amount_cents integer NOT NULL,
  previous_balance_cents integer NOT NULL,
  new_balance_cents integer NOT NULL,
  receipt_ref text,
  receipt_normalized text,
  idempotency_key text NOT NULL,
  original_spend_id integer REFERENCES store_card_ledger(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_card_positive_amount CHECK (
    amount_cents > 0 AND previous_balance_cents >= 0 AND new_balance_cents >= 0
  ),
  CONSTRAINT store_card_kind_coherent CHECK (
    (kind = 'spend'
      AND new_balance_cents = previous_balance_cents - amount_cents
      AND receipt_ref IS NOT NULL AND receipt_normalized IS NOT NULL
      AND original_spend_id IS NULL AND reason IS NULL)
    OR
    (kind = 'reversal'
      AND new_balance_cents = previous_balance_cents + amount_cents
      AND receipt_ref IS NULL AND receipt_normalized IS NULL
      AND original_spend_id IS NOT NULL AND reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX store_card_receipt_unique
  ON store_card_ledger (store_id, receipt_normalized) WHERE kind = 'spend';
CREATE UNIQUE INDEX store_card_idempotency_unique
  ON store_card_ledger (employee_id, store_id, idempotency_key);
CREATE UNIQUE INDEX store_card_reversal_unique
  ON store_card_ledger (original_spend_id) WHERE kind = 'reversal';
CREATE INDEX store_card_history_card ON store_card_ledger (card_id);