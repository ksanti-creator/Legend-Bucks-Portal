---
name: Per-user award budget & global max single award
description: How award spending is limited in Legend Bucks after the manager-budget redesign
---

Award-spending limits live on the **awarding user**, not the recipient or a department.

- **Per-user yearly award budget**: nullable int column on the employee row. Draws down as that user awards ('award' tx). Resets on the UTC calendar year (no carryover). `null` budget = the user cannot award at all. Set by admins on invite and on the employee detail dialog. Backfilled a default for existing admin/manager rows.
- **Global "maximum single award"**: a single key/value row in an `app_settings` table (key `max_single_award`). Admin-only to change; any authed user may read it (client-side validation). Absent row = no limit.

**Enforcement (POST /transactions):** check global max first, then lock the *sender's* employee row `FOR UPDATE`, compute their YTD awarded total, check against their budget, then insert — all in one transaction. The self-award guard runs BEFORE the budget check.

**Visibility:** award-budget is private — the `GET /employees/{id}/award-budget` endpoint and the `awardBudgetYearly` field on the employee response are authorized to **self + admin only** (via an `includeBudget` gate in the response builder). Never leaked in list endpoints.

**Why:** replaced both the department "team budget" pool and the per-recipient shared cap. The old models limited the wrong party; budgets now belong to whoever spends.

**How to apply:** any new award path must go through the same atomic sender-lock + global-max flow, or budgets can be over-drawn under concurrency. Any new setting goes in `app_settings` as another key.
