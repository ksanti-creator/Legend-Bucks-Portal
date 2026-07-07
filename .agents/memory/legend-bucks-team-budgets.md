---
name: Team (department) budgets
description: Durable invariants for per-department budget pools that fund team goals in Legend Bucks.
---

# Team (department) budgets

A "team" is a **department**; each has a per-**calendar-year** pool that managers
(and admins) draw down by awarding toward that department's team goals.

## Invariants

- **Current UTC year only, implicitly.** No `year` param on the endpoints — a
  deliberate choice to dodge the orval path+query name collision
  (see `orval-param-name-collision`). Multi-year support means a body/sub-resource, not a query param.
- **Awards fund the goal, never a person.** The award transaction type is
  excluded from balance and award-cap math so pool spend can't leak into anyone's
  spendable balance. This is distinct from the personal "contribute" flow, which
  spends the caller's own balance.
- **"Used" is ledger-derived, never stored**, attributed via the goal's *current*
  department. **Caveat:** moving a goal between departments retroactively shifts
  historical usage between pools (accepted — team goals aren't expected to move).

## Cross-cutting lessons (apply beyond this feature)

- **A new transaction-type enum value is a two-front change:** the Postgres enum
  AND the OpenAPI `Transaction.type` enum. Miss the spec side and any endpoint
  that zod-parses a transaction 500s the moment a row of the new type exists —
  invisible until such data appears.
- **Pool/balance spend must be atomic end-to-end.** Lock the scarce row
  (`SELECT ... FOR UPDATE`) *and* mutate counters with a SQL increment
  (`col = col + n`) inside the same tx. **Why:** locking the pool row still lost
  goal progress because `currentAmount` was read *before* the tx, so a serialized
  second award overwrote the first with a stale base. Never read-then-write a
  counter that a concurrent request also bumps.

## Legacy goal → department link

`goals.departmentId` is a real FK (nullable = company-wide); legacy free-text
`department` is display-only fallback. Backfill of old rows by case-insensitive
name match lives in `scripts/post-merge.sh` (idempotent) so it reproduces on prod
push, not just the dev DB.
