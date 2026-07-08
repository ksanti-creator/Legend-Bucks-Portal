---
name: Legend Bucks prod DB, admin bootstrap & reset
description: How the two databases relate, why the first admin can't self-serve, and the safe way to reset prod data or seed an initial admin.
---

# Prod vs dev database, and bootstrapping/resetting

- **Dev and prod are SEPARATE databases**: development = `heliumdb`, production = `neondb`. They can hold identical seed data but are physically distinct. Confirm with `SELECT current_database()` per environment.
- **Prod is read-only via agent tools**: `executeSql({ environment: "production" })` only allows SELECT. You cannot INSERT/UPDATE/DELETE/TRUNCATE prod from the agent. Writes must run inside the deployed app (which holds prod's `DATABASE_URL`).
- **No public signup, no bootstrap-admin flow**: employees only exist via an admin-only `/auth/invite`. Requesting a magic link for an email that isn't an existing (non-inactive) employee **silently no-ops** (anti-enumeration) — so "I never got the magic link" usually means the account doesn't exist, not an email delivery bug.

## Safe pattern to reset prod data or seed the first admin
**Why:** there's no in-app way to create the very first admin or wipe prod, and the agent can't write prod directly.
**How to apply:**
1. Add a temporary `POST /bootstrap/reset`-style route guarded by a `BOOTSTRAP_SECRET` env var (disabled when unset; require exact header match). It TRUNCATEs app tables `RESTART IDENTITY CASCADE` and inserts the admin.
2. Set `BOOTSTRAP_SECRET` (shared env var so the deployment inherits it). Trigger dev via `http://127.0.0.1:80/api/...` to also clean dev.
3. User **publishes** so the route+secret reach the live build; then POST the prod URL (`getDeploymentInfo().primaryUrl`) with the secret header.
4. **Remove the route, delete the secret, and have the user publish AGAIN.** Deleting the env var / code locally does NOT affect the already-running deployment until a republish — until then the live reset endpoint stays exploitable.
