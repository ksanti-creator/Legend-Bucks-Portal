---
name: Award authorization & limits
description: How awarding bucks is gated in Legend Bucks (roles + global max single award). The per-user yearly budget was removed.
---

# Awarding bucks — what gates it

Awarding (POST /api/transactions, type `award`) is constrained by exactly two things:

1. **Role allow-list** — only `admin` and `manager` may award (`canAwardBucks` in `lib/auth.ts`, a positive allow-list). `team_member` and `accounting_admin` get 403. Self-awards are always blocked server-side.
2. **Global "max single award"** — a single optional cap in `app_settings` (key `max_single_award`, read via `getMaxSingleAward`). Absent row = no limit. Applies to every awarding role, admins included.

There is **no per-user / yearly award budget** and no atomic budget draw-down. The award endpoint just inserts the row after the two checks above.

**Why:** The per-user `awardBudgetYearly` column + `/employees/{id}/award-budget` endpoint + `AwardBudgetInfo` schema + `lib/awardBudget.ts` were all removed on request (July 2026). Users found the yearly budget cumbersome; recognition should be as frequent as deserved, capped only by the single-award ceiling.

**How to apply:** If asked to "limit awards," reach for the global max-single-award setting, not a per-user budget. Do not reintroduce `awardBudgetYearly` unless explicitly asked. If a future task references an "award budget" (e.g. "spot who's running low on budget"), it's obsolete — confirm before building.
