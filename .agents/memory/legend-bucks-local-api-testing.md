---
name: Legend Bucks local API testing
description: How to curl the API server during development (which base URL actually works)
---

# Curling the Legend Bucks API in dev

The API server is a separate artifact, NOT served at `$REPLIT_DEV_DOMAIN/api`
(that returns empty). The frontend uses a **relative** `/api` base (no
`setBaseUrl` is called), and both apps are reached through the shared preview
proxy at `http://127.0.0.1:80`.

**To test the API from the shell, use `http://127.0.0.1:80/api/...`.**

**Why:** the legend-bucks web app is mounted at `/` on the shared proxy, and
`/api/*` is proxied to the api-server from there. Hitting the raw dev domain
bypasses that routing and yields empty responses.

**How to apply:** for auth'd calls, POST `/api/auth/login` (dev returns a
`token`), POST `/api/auth/verify` with it to get a session token, then send
`Authorization: Bearer <sessionToken>`.

## Screenshotting authenticated pages (mobile/desktop)
The screenshot browser can't set localStorage, but `/login?token=<magic>` auto-verifies and lands on /dashboard. Get a dev magic token via `POST /api/auth/login` (token returned when NODE_ENV != production). Each screenshot needs a fresh single-use token; only /dashboard is reachable this way. The screenshot browser's origin is `http://127.0.0.1`, which is in the API CORS allow-list (added alongside localhost) — without it, POST verify fails with a CORS 500.
