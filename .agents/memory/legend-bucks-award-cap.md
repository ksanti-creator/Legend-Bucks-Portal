---
name: Per-employee yearly award cap
description: How the manager award limit works in Legend Bucks (replaced the old monthly budget system)
---

# Per-employee yearly award cap

The only limit on manager awards is a per-recipient yearly cap (`employees.awardCapYearly`, int nullable; null = no limit). The old manager monthly-budget system (budgets table, /budgets endpoints, Budget schemas, notifyBudgetAssigned) was removed entirely.

## Rules
- **Scope = assigned manager only.** The cap is enforced only when the awarding manager IS the recipient's assigned manager (`recipient.managerId === user.id`). Non-assigned managers and admins are never limited.
  - **Why:** enforcement and the cap-info endpoint must report the same "remaining" number. The info endpoint (`GET /employees/:id/award-cap`) computes usage for the *assigned* manager, so enforcement must match or the displayed remaining diverges from what's actually blocked. Also matches the literal task wording ("that employee's manager").
- **Boundary is UTC calendar year, half-open [Jan 1 00:00Z, next Jan 1).** `currentYearRange()` uses `getUTCFullYear()` + `Date.UTC(...)` so the boundary is timezone-deterministic against timestamptz `created_at`. Exactly-at-cap is allowed (block only when `amount > remaining`).
- **Privacy:** cap + remaining are exposed ONLY via `GET /employees/:id/award-cap`, authorized to admins and the assigned manager. The employee themselves and unrelated managers get 403. The cap is deliberately NOT on the `Employee` schema — the edit dialog / detail card / send-bucks read it from this endpoint instead.
- **Setting the cap is admin-only:** persisted at invite (`POST /auth/invite`) and via `PATCH /employees/:id` — both already admin-only.

**How to apply:** if you add team/dept budgets (task family) or a management-chain authority model, revisit the "assigned manager only" scope — a manager can currently sidestep a cap by having another manager award the same person.
