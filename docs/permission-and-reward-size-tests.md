# Permission and reward-size regression verification

Verified in the isolated development sandbox on 2026-10-01.
Original baseline: `docs/visual-refresh-tests.txt` (148/150 passing).

## Root causes and intended behavior

- Fulfillment checked `approved` status before checking whether accounting was
  allowed to fulfill that reward. Accounting is allowed to process Time Off,
  but must receive 403 for ordinary rewards regardless of their status.
  The route now authorizes an existing resource before checking its workflow
  state. Missing resources retain the existing 400 response, and malformed
  parameters still undergo parameter validation.
- The declared schema and the regular development schema both have
  `reward_sizes.reward_id -> rewards.id ON DELETE CASCADE`. Read-only catalog
  inspection found no such FK in the sandbox. `LIKE INCLUDING ALL` does not
  copy foreign keys. Application-side reward deletion was correct and remains
  unchanged.

## Sandbox repair and safety

- Verified `NODE_ENV=development`, sandbox enabled, `search_path` exactly
  `legend_bucks_sandbox`, and no other active user schemas before mutations.
- Added a manual, transaction-wrapped, sandbox-only repair:
  `NODE_ENV=development pnpm --filter @workspace/scripts run sandbox:repair-reward-sizes`.
  It is also used by manual sandbox bootstrap, never by app startup or production.
- The repair is schema-only and targets sandbox tables explicitly. Running it
  twice succeeded, confirming idempotence.
- Ten pre-existing orphan size rows were observed and deliberately preserved:
  they are not owned by this task's fixtures. The FK uses `NOT VALID` for that
  legacy data but enforces new writes and cascades parent deletion. Clean
  sandboxes validate the constraint fully.
- New tests use fixture-owned cleanup. No production data, public schema DDL,
  broad cleanup, real mail, or real gift-card issuance was used.

## Coverage

- Accounting denied ordinary requested and approved fulfillment, with unchanged
  redemption/ledger state and no fulfillment email.
- Admin requested fulfillment still fails; approved ordinary fulfillment works;
  accounting Time Off fulfillment continues to work.
- Normal custom gift-card fulfillment remains blocked; both catalog and
  redemption snapshot safety checks are covered independently.
- Multiple size rows cascade on API and direct database deletion; another
  reward's size rows remain unchanged; repeat API deletion returns 404;
  inserting a new orphan is rejected.
- Catalog regression verifies the cascade target is inside the sandbox.

## Verification

- `NODE_ENV=development pnpm --filter @workspace/api-server test`:
  **18 files passed, 159 tests passed** (including nine additional tests).
- `pnpm run typecheck:libs`: passed.
- `pnpm --filter @workspace/scripts run typecheck`: passed.
- `pnpm --filter @workspace/api-server run typecheck`: passed.
- `git diff --check`: passed.
- API workflow restarted successfully; `/api/healthz` returned `{"status":"ok"}`.