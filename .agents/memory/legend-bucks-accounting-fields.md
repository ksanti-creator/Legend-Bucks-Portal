---
name: Legend Bucks accounting-only fields
description: How to keep an admin-only money field (e.g. reward CAD value) from leaking through role-scoped endpoints.
---

# Accounting-only reward fields (e.g. CAD value)

An "admin/accounting-only" field on a reward must be gated in **every** enrichment
function that can surface it, not just the obvious one:

- `rewards` route — `GET /rewards` is the same endpoint the public catalog uses; gate the field on `user.role === "admin"` in the reward serializer.
- `redemptions` route — **this is the easy-to-miss leak**: `/redemptions` and `/redemptions/:id` are visible to team members (their own) and managers (broader), so `enrichRedemption` must take an `isAdmin` flag and null the field for non-admins on *all* responses (list/get/create/approve/reject/cancel/fulfill).
- `transactions` route — `enrichTransaction` must also gate it; the ledger is visible to team members for their own rows.

**Why:** managers and team members legitimately hit the redemptions/transactions endpoints, so a field that is null-ed only in the rewards serializer still leaks over the wire through those other endpoints.

**How to apply:** snapshot the value onto the redemption row at redemption time (historical accuracy), then read it back through the redemption in the ledger. Store money as integer cents; convert dollars↔cents only at the UI boundary, and preprocess blank form input to `null` (not `0`) so an unset value stays unset.
