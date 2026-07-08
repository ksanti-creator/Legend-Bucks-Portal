---
name: Per-employee yearly award cap
description: How the manager award limit works in Legend Bucks (replaced the old monthly budget system)
---

# Per-employee yearly award cap

The only limit on manager awards is a per-recipient yearly cap (`employees.awardCapYearly`, int nullable; null = no limit). The old manager monthly-budget system (budgets table, /budgets endpoints, Budget schemas, notifyBudgetAssigned) was removed entirely.

## Rules
- **Scope = the whole management chain (shared cap).** The cap counts the *combined* awards from everyone in the recipient's upward `manager_id` chain (direct manager, that manager's manager, …) for the UTC year, and is enforced against any awarding manager who is in that chain. So a senior manager can't bypass it by routing an award through a report. Managers outside the chain and admins are never limited. Chain resolution lives in `lib/orgChain.ts` (`getManagerChain` = ancestors, cycle-safe); the cap sum is `getChainAwardedThisYear(employeeId, precomputedChain?)`.
  - **Why:** enforcement and the cap-info endpoint must report the same "remaining". Both now derive chain membership from `getManagerChain` and usage from `getChainAwardedThisYear` — keep them using the identical chain computation or displayed remaining diverges from what's blocked.
- **Boundary is UTC calendar year, half-open [Jan 1 00:00Z, next Jan 1).** `currentYearRange()` uses `getUTCFullYear()` + `Date.UTC(...)`. Exactly-at-cap is allowed (block only when `amount > remaining`).
- **Privacy:** cap + remaining are exposed ONLY via `GET /employees/:id/award-cap`, authorized to admins and *any manager in the employee's chain* (ancestor, not just direct). The employee themselves and unrelated managers get 403. Client pages let any manager attempt the fetch (`retry:false`) and rely on the 403 to hide the cap card. The cap is NOT on the `Employee` schema.
- **Setting the cap is admin-only:** persisted at invite and via `PATCH /employees/:id`.
- **Subtree roll-up:** `GET /employees?managerId=X` returns X's whole subtree (direct + indirect reports via `getSubtreeIds`), not only direct reports. Managers do NOT get award authorization *restricted* to their subtree — the send-bucks server still allows awarding anyone; only the manager's recipient picker UI is scoped to their subtree.

**How to apply:** cycle-safety is mandatory — `manager_id` has no FK/self-ref guard, so any traversal must use a visited set. If you add team/dept budgets, keep them flat per-dept (separate model from this chain cap).
