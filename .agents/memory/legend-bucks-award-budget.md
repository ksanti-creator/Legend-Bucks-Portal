---
name: Award authorization & limits
description: How awarding bucks is gated in Legend Bucks — role + per-user yearly budget + global max single award. Note the removal/reinstatement history.
---

# Awarding bucks — what gates it

Awarding (POST /api/transactions, type `award`) is constrained by three things:

1. **Role allow-list** — only `admin` and `manager` may award (`canAwardBucks` in `lib/auth.ts`, a positive allow-list). Everyone else gets 403. Self-awards are always blocked.
2. **Per-user yearly award budget** — `employees.award_budget_yearly` (nullable). The awarding user draws this down; enforcement is atomic (locks the sender row, sums current-year awards, rejects if over) in `transactions.ts`. A null budget means the user cannot award until one is set.
3. **Global "max single award"** — one optional cap in `app_settings` (key `max_single_award`, via `getMaxSingleAward`). Absent = no limit. Applies to all awarding roles.

# Invite auto-fill

When inviting someone whose selected role is `admin` or `manager`, the invite form (`invite-employee.tsx`) shows the Yearly Award Budget field and pre-fills a default of **50000** (only when empty, so a manual edit sticks). Selecting `team_member` clears it to null. `post-merge.sh` adds the column and seeds existing admins/managers to 50000.

**Why:** This feature was briefly removed entirely (July 2026) then reinstated by user request, with the added ask that admins/managers get a default budget populated at invite time. The current design (per-awarder yearly budget + 50000 default) is intentional — treat any assumption that the budget doesn't exist as stale.

**How to apply:** Budget limits belong on the awarding user, not per-recipient. Default new admins/managers to 50000. Don't confuse this with the global max-single-award (a separate, single setting). If a future task assumes the budget doesn't exist, it's stale — this is the current design.
