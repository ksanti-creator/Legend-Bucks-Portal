---
name: Postgres UPDATE cannot use ORDER BY / LIMIT
description: Raw UPDATE ... ORDER BY ... LIMIT is invalid Postgres and 500s at runtime; scope-limit updates with a subquery instead.
---

# Postgres UPDATE does not support ORDER BY / LIMIT

**Rule:** A raw `UPDATE ... WHERE ... ORDER BY ... LIMIT 1` is not valid PostgreSQL. It parses in MySQL/SQLite but Postgres throws at execution time, surfacing as a 500. To update just one matching row, use a subquery: `UPDATE t SET ... WHERE id = (SELECT id FROM t WHERE ... ORDER BY ... LIMIT 1)`.

**Why:** The redemption-create path linked the just-inserted `redemption_debit` transaction back to the redemption with `UPDATE transactions SET redemption_id=... WHERE ... ORDER BY created_at DESC LIMIT 1`. It always 500'd the real redeem flow, but stayed invisible because tests only ever seeded redemptions directly and never exercised the create endpoint.

**How to apply:** Grep raw `db.execute` SQL for `UPDATE`+`LIMIT`/`ORDER BY`. Prefer capturing the row id at insert time (the insert already `.returning()`s it) and updating by that id, rather than re-finding "the latest" row. Always drive new/critical endpoints with a positive test that hits the real path, not just seeded fixtures.
