---
name: drizzle-kit push renames hang in non-TTY
description: Why post-merge/CI schema migrations must pre-apply idempotent SQL before push
---

`drizzle-kit push` — even with `--force` — triggers **interactive rename resolver prompts** whenever a diff is ambiguous (table drop+create vs rename, column drop+add vs rename). In a non-TTY environment (post-merge script, CI) those prompts hang forever with no output.

**Rule:** for any rename/drop that drizzle can't unambiguously infer, apply explicit **idempotent SQL** first (guarded with IF EXISTS / existence checks), so that by the time `push --force` runs there is no ambiguous diff left ("No changes detected").

**Gotchas discovered:**
- Postgres can't drop a value from an enum type; recreate the type (guard on whether the old value still exists).
- Postgres rejects ORDER BY / LIMIT on UPDATE — such raw SQL 500s only when a real code path hits it.

**Why:** table/column renames during the manager-budget redesign silently hung the post-merge migration until the SQL was pre-applied.

**How to apply:** put the transform SQL in `scripts/post-merge.sh` before the `push-force` step; keep it idempotent so re-runs are safe.
