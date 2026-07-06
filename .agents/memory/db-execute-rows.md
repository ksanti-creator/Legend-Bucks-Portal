---
name: db.execute returns { rows }, not an array
description: Raw db.execute() in this repo returns a node-postgres QueryResult; access .rows or you get silent wrong data / crashes.
---

`db` is drizzle-orm/node-postgres (`lib/db/src/index.ts`, `drizzle(pool)`). `await db.execute(sql)` returns the node-postgres **QueryResult object** (`{ rows, rowCount, ... }`), NOT a directly iterable array.

Two failure modes seen in `artifacts/api-server/src/routes/*`:
- Destructuring `const [row] = await db.execute(...)` or `rows.map(...)` → throws `is not iterable` / `.map is not a function` (500).
- Indexing `(result as any)[0]?.total ?? "0"` → `[0]` on the object is `undefined`, so it silently defaults (e.g. balances/sums read as 0) with NO error. This latent pattern still exists in `lib/auth.ts` (getEmployeeBalance), `routes/employees.ts`, `routes/budgets.ts`, `routes/transactions.ts`.

**How to apply:** For any raw `db.execute`, read `.rows` first: `const { rows } = await db.execute<T>(...)` then use `rows[0]`. Prefer the drizzle query builder (`db.select()...`) over raw SQL where possible — those return arrays directly and are correct.
