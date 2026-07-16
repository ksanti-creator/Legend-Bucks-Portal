---
name: Legend Bucks role-guard fallthrough
description: Authorize writes with explicit allow-lists; exclusion guards silently grant new roles write/spend power.
---

# Authorize writes by allow-list, not by exclusion

**Rule:** Every endpoint that writes or moves bucks (award, send, redeem, cancel/refund, contribute) must authorize by naming exactly which roles may act (an allow-list), never by excluding one role and letting everyone else through.

**Why:** Several money-moving endpoints gated with `if (role === "team_member") 403` and treated "not a team member" as privileged. When a read-only finance role was later added, it was neither team_member nor admin, so those guards let it send bucks, redeem/cancel rewards, and contribute to goals — writes it must never do. Some paths (redemption create, goal contribution) had no role check at all. Exclusion guards fail open for every future role.

**How to apply:** When adding any new role, audit every write endpoint's auth. If it's an exclusion check, convert it to an allow-list for strict capabilities. Read-only accounting access (full ledger, CSV export, CAD cost values) is centralized in `canViewAccounting(role)` — reuse it instead of inline role checks.

## Scoped lists need matching detail-endpoint checks
When a list endpoint scopes rows by role (e.g. manager sees only their reporting subtree), the corresponding `GET /:id` endpoint must apply the same scoping — otherwise it's an IDOR-style read leak. Caught by review when adding manager redemption approvals (July 2026): approve/reject/list were scoped but the detail fetch still let managers read any redemption.
