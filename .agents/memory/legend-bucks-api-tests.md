---
name: Legend Bucks api-server test harness
description: How integration tests run against the API, and the shared-DB cleanup rule.
---

The api-server has a vitest + supertest integration suite (`pnpm --filter
@workspace/api-server test`). Tests import the Express `app` directly (it does NOT
call listen — that's only in index.ts) and drive it with supertest, no network.

Auth in tests: seed an employee row, then mint a Bearer token with `createSession`
(from lib/auth) — skip the whole magic-link/email flow.

**Critical constraint:** tests run against the ONE real shared Postgres dev DB (there
is no separate test DB). So:
- Give every fixture a random-suffixed unique name/email and delete ONLY the ids the
  test created (track them). Never clean up by a broad predicate like
  `firstName = "New"` — it will match and delete unrelated real rows.
- Run suites serially (`fileParallelism: false` in vitest.config.ts) to avoid
  cross-suite interference.

**Why:** a broad-match cleanup once got flagged in review as able to wipe real data,
and parallel suites on a shared DB cause flaky counts.

**How to apply:** reuse `src/test/helpers.ts` (Fixtures class) for any new suite —
it seeds employees/departments/locations + sessions and cleans up by owned id.

## Supervised production gift-card checks

Never run the fixture-creating store gift-card automated suite against production. Live checks must use designated participants and a controlled card, with explicit approval of the amount, store, and Accounting reconciliation before any transaction.

**Why:** The user requires supervised live testing, not sandbox fixtures or unapproved real-value activity.

**How to apply:** Inspect deployment and access read-only first. Keep full card codes and login links out of chat/logs. Do not infer permission to change feature flags, publish, migrate, grant till access, or transact from a request to inspect readiness.
