# Legend Bucks

An internal employee rewards platform for Legend Boats. Employees earn "Legend Bucks" for great work and can redeem them for rewards.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/legend-bucks run dev` — run the frontend (port 18471)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (pre-configured)

## Demo Login

In development, the API returns the magic link token directly in the response (no email needed). Use any of these emails:
- `sarah.mitchell@legendboats.com` — admin
- `james.kowalski@legendboats.com` — manager (Manufacturing, Fond du Lac)
- `rachel.torres@legendboats.com` — manager (Sales, Beaver Dam)
- `mike.henderson@legendboats.com` — team member

Direct session tokens for testing (set as cookie `session_token`):
- Admin: `demo-admin-token-legend-bucks-2024`
- Manager: `demo-manager-token-legend-bucks-2024`
- Team member: `demo-member-token-legend-bucks-2024`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind (Wouter routing)
- API: Express 5 + Pino logging
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Auth: Magic-link email tokens + HTTP-only session cookies
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (employees, sessions, budgets, transactions, rewards, redemptions, goals)
- `artifacts/api-server/src/routes/` — Express route handlers (auth, employees, budgets, transactions, rewards, redemptions, goals, dashboard)
- `artifacts/api-server/src/lib/auth.ts` — magic token + session logic, balance calculation
- `artifacts/legend-bucks/src/pages/` — React pages (login, dashboard, employees, rewards, send-bucks, transactions, redemptions, goals, budgets)
- `artifacts/legend-bucks/src/components/layout/Shell.tsx` — authenticated layout shell with sidebar nav

## Architecture decisions

- **Balance is ledger-derived**: never stored on the employee row; always calculated from `transactions` table. Types: `award`, `redemption_debit`, `refund`, `contribution`, `adjustment`.
- **Magic link auth only**: no passwords. Tokens expire in 15 min and are single-use. Sessions last 30 days via HTTP-only cookie.
- **Role-based access**: `admin` > `manager` > `team_member`. Managers can only send within their monthly budget. Team members only see their own transactions/redemptions.
- **Redemption approval flow**: if `approval_required = true`, redemption starts as `requested`; bucks are debited immediately but refunded if rejected/cancelled.
- **Budget tracking**: manager budgets are per-month (`YYYY-MM`); used amount is summed live from the awards ledger, not stored.

## Product

- **Login**: Magic link flow; admin invites employees by email
- **Dashboard**: balance card, recent activity feed, leaderboard, summary stats, pending approvals count
- **Send Bucks**: managers/admins send bucks to employees with optional note; managers gated by monthly budget
- **Employees**: directory, detail view with balance + transaction history, invite new employee, deactivate
- **Rewards**: catalog with category/location filters, redemption flow with balance check
- **Redemptions**: status tabs (requested/approved/rejected/fulfilled/cancelled), admin approval queue
- **Goals**: team goals with progress bars, contribute bucks toward shared department goals
- **Budgets**: manager budget overview, admin assigns/edits monthly budgets
- **Ledger**: full paginated transaction history with CSV export (admin), filtered per employee (team member)

## User preferences

_Populate as you build._

## Gotchas

- After any `lib/db/src/schema` change, run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs` before running the API server typecheck.
- After any `lib/api-spec/openapi.yaml` change, run `pnpm --filter @workspace/api-spec run codegen` before touching frontend or backend code.
- The `getEmployeeBalance()` function in `auth.ts` must handle all five transaction types (`award`, `redemption_debit`, `refund`, `contribution`, `adjustment`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
