---
name: Legend Bucks email notification preferences
description: Where opt-outs are enforced and which emails must never be gated.
---

Per-user email opt-outs live as boolean columns on the employees row (default true =
opted in). Preferences are checked at each **send call site** (the recipient's full
employee row is already in scope there), NOT inside the email helpers in
`lib/email.ts` — the helpers only take a `to` address, not an employee.

**Critical mails are always sent, never gated:** magic-link sign-in and invite
emails. Gating those would lock people out of their own account.

**Why:** the send functions are address-only, so centralizing the check there would
need an extra lookup and risk gating auth mail. Gating at the call site keeps the
preference next to the recipient row and makes the always-send exceptions explicit.

**How to apply:** any NEW transactional email must (a) look up the recipient's
preference column and skip when off, and (b) be classified critical-vs-optional —
only account-access mail (login/invite) stays ungated. Self-service updates go through
`PATCH /auth/me/notifications` (self-scoped by session user id, no target id param).
