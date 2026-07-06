---
name: Legend Bucks schema rebuild rule
description: After any lib/db schema change, typecheck:libs must run before API server typecheck or all table imports fail with TS2305.
---

When `lib/db/src/schema/` is changed and `pnpm --filter @workspace/db run push` is run, the TypeScript declaration files for `@workspace/db` become stale until `pnpm run typecheck:libs` rebuilds them.

**Why:** The API server imports tables from `@workspace/db` using the compiled `.d.ts` declarations. If those are stale, every import shows TS2305 ("Module has no exported member").

**How to apply:** After any schema file edit → push → run `pnpm run typecheck:libs` → then run `pnpm --filter @workspace/api-server run typecheck`.
