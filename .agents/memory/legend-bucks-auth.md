---
name: Legend Bucks auth pattern
description: Token(Bearer)-based session auth for the Replit iframe; balance calculated from ledger.
---

Auth uses magic tokens (15-min, single-use) that are exchanged at `/auth/verify` for a 30-day session.

**Session transport is Bearer token, not cookie.** The verify response returns the session token in the body (`AuthSession` schema in `openapi.yaml`). The web client stores it in `localStorage` and sends it as `Authorization: Bearer` via `setAuthTokenGetter` (registered at startup in `main.tsx`). `requireAuth` accepts the Bearer header first, cookie as fallback. `/auth/logout` must revoke whichever token was presented — reuse `extractSessionToken(req)`.

**Why:** The Replit preview runs the app in an iframe on a different domain than the address bar, so the server's `SameSite=None` session cookie is a blocked third-party cookie — browsers never store it, and cookie-only auth silently fails in preview. No cookie-attribute tweak fixes this; the token/header transport is the reliable path (also works in a standalone tab and deployed).

**How to apply:** Any new authenticated endpoint just uses `requireAuth`. Any new client mutation that changes auth state must keep the localStorage token in sync (store on login/verify, clear on logout).

`requireAuth` sets `req.currentUser` (typed via Express namespace augmentation in `auth.ts`). `getCurrentUser(req)` returns the typed Employee; throws if called outside auth middleware.

Balance is always derived from the `transactions` table — never stored on the employee row. `getEmployeeBalance(id)` handles all five types: award, redemption_debit, refund, contribution, adjustment.
