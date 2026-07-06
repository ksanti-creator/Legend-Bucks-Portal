---
name: Legend Bucks auth pattern
description: Magic-link session auth; balance calculated from ledger; typed request augmentation for currentUser.
---

Auth uses magic tokens (15-min, single-use) + HTTP-only session cookies (30 days).
`requireAuth` middleware sets `req.currentUser` (typed via Express namespace augmentation in `auth.ts`).
`getCurrentUser(req)` returns the typed Employee; throws if called outside auth middleware.

Balance is always derived from the `transactions` table — never stored on the employee row.
`getEmployeeBalance(id)` handles all five types: award, redemption_debit, refund, contribution, adjustment.

**Why:** Stored balance can drift during partial failures. Ledger is the source of truth.

**How to apply:** Any new endpoint that needs the user's balance must call `getEmployeeBalance(user.id)` — never read a `balance` column from `employees`.
