---
name: Legend Bucks publish schema divergence
description: Why a prod publish can fail with build OK but no runtime logs — dev↔prod schema diff needs confirmation.
---

# Failed prod publish = blocked publish-time schema migration

**Symptom:** Publish build shows `failed`, but the Docker build/image-push logs are clean and there are **zero runtime/deployment logs** for the failed build's window (container never promoted).

**Diagnosis path that works:** the app never crashes at startup unless `DATABASE_URL` is missing — `/api/healthz` is static, the pg pool is lazy, and there are no import-time DB queries. So "build failed + no runtime logs" points *before* promote: the **publish-time dev→prod schema diff** failed. Compare `information_schema.columns`/`tables` across `executeSql({environment:"development"})` vs `"production"` to see the diff.

**Root cause seen here:** the award-budget redesign left dev and prod diverged:
- rename `employees.award_cap_yearly` → `award_budget_yearly`
- drop old `team_budgets` table
- add `app_settings` table

An unconfirmed **rename** plus a **table drop** are non-backwards-compatible; Replit's publish flow requires confirming these in the Publish UI, and the migration is blocked until then.

**Fix (do NOT run prod DDL):** dev schema is the source of truth — verify the feature in dev, then have the user **re-publish** and confirm the rename/drop prompts in the Publish UI. Never `executeSql` DDL on prod, never add deploy-build/startup DDL hooks (see database-migrations-on-publish reference).

**Why:** prod schema is owned by Replit's publish diff, not the app. Scripts/hooks that push dev→prod are the documented wrong answer.
