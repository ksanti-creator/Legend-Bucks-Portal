# In-project Training Mode: inspection and isolation proposal

Date: 2026-10-09

**Status: BLOCKED at isolation provisioning; not implemented or ready to publish.**

This replaces the separate-project ZIP approach. Training belongs in this portal
and deployment. The proposed entry is `/training`; that route is not implemented.
No application code, deployment settings, database data, or schema was changed
during this assessment. No fixtures or installation commands were run.

## Inspected evidence

- Deployment metadata reports a successful, public autoscale deployment at
  `https://legend-bucks-portal.replit.app`. The served frontend asset is
  `/assets/index-Du7aQsfH.js`. This is a frontend fingerprint, **not proof of the
  deployed backend's source revision**; deployment metadata did not expose one.
- Health returned 200. Unauthenticated identity, checkout status and checkout
  transaction requests returned 401. These are read-only smoke checks, not
  regression or role tests.
- Production configuration has both development sandbox flags false and store
  checkout enabled. No `TRAINING_DATABASE_URL`, `TRAINING_DB_URL`,
  `TRAINING_SCHEMA`, or `TRAINING_MODE_ENABLED` was found through the
  configuration interface. No secret values were read.
- Read-only production catalog inspection found `public`, but neither
  `legend_bucks_training` nor `legend_bucks_sandbox`. The inspected connection
  role has BYPASSRLS and role/database creation privileges. It is not a
  training-only least-privilege connection. This observation is about the
  database inspection connection, not an independent proof of deployed app
  credentials.
- Current source creates one process-wide Drizzle instance and connection pool.
  The development sandbox changes its search path for the entire process.
  `sandboxEnabled()` intentionally throws outside development; retain this.
- Existing auth sessions reference employee IDs in that selected database.
  There is no separate production training-session namespace or admission gate.
- Current gift-card routes enforce admin approval and a distinct admin issuance
  action. Store checkout requires an explicit employee/store grant and matching
  location. Spending uses transactions, locks, lookup capabilities, unique
  receipts and idempotency constraints.
- Accounting Admin can view the general ledger, but store-card reconciliation
  currently requires admin. Training must not silently promote an accountant to
  admin or alter normal-mode permissions.
- Gmail and object-storage suppression currently use the process-wide
  development sandbox check. They do not provide per-request production-safe
  isolation or a visible simulated outbox.
- Existing checkout tests explicitly require the development sandbox. They
  create fixtures and must not be run against production.
- Sandbox bootstrap clones table structures and repairs some constraints and
  sequences. It is not a production training provisioner. `LIKE INCLUDING ALL`
  does not recreate foreign keys; a training schema needs full structural
  validation, not just table-name checks.

## Proposed isolation boundary

1. Keep normal requests, authentication and deployment unchanged. Serve the
   actual existing workflow components under `/training`, with a corresponding
   server-owned training API namespace.
2. Provision a separate training schema with a dedicated connection role that
   cannot select, insert, update or delete live tables, use live sequences, or
   execute privileged functions that reach live data. No public search-path
   fallback. Do not use the owner connection as training credentials.
3. Bind a verified training session to that connection on the server before any
   workflow handler runs. A URL, query parameter, header or browser flag alone
   never selects a tenant. Reject training credentials on ordinary APIs and
   ordinary credentials on training workflow APIs.
4. A narrow authenticated live-admin control gateway may admit trainers, enable
   or disable access, and initiate reset. Ordinary training handlers must not
   receive the live connection. Persist the association needed to revoke
   training access, but never copy live people or balances into dummy tables.
5. Validate required tables, constraints, sequences, privileges and seed version
   before admission. Missing configuration returns unavailable; it never falls
   back to normal storage. Never seed or run DDL at application startup.
6. Reuse actual reward, redemption, issuance and checkout handlers through
   explicit tenant-scoped data/side-effect services. No second mock ledger.
   Scope transactions, caches, locks, exports, jobs and audit events. Detached
   jobs must carry a verified tenant identity, not infer one from ambient state.
7. Deny outbound connectors and production storage before constructing a
   transport or signing a URL. Persist sanitized simulated-delivery events in
   a training-only outbox. No email, SMS, vendors or accounting integrations.
   Any future integration must default to denied in training.
8. Never put full card codes in outbox previews, exports, URLs, logs or
   screenshots. Use an opaque, tenant- and session-bound training card selector
   to exercise the existing lookup/spend service privately. The visible outbox
   shows simulated recipient, delivery status, card reference and masked code.
9. Use separate browser session storage, query clients/cache keys and till
   drafts. Persist `TRAINING — DUMMY DATA` on every training screen, transaction,
   receipt, export and outbox item. Prevent switching modes with a pending spend.
10. Admin-only reset uses a fixed training-table allowlist, scoped transaction
    and tenant lock; it revokes training sessions and lookup capabilities before
    reseeding generated dummy identities. It must not accept schema/table names
    from a request or truncate live tables through cascading references.

### Roles

Seed distinct dummy admin, manager, accounting_admin, employee and store operator
identities. Manager approves eligible ordinary rewards for direct/indirect
reports, but cannot approve or issue gift cards. Only dummy admin performs gift
approval/issuance and controls training reset. Accounting uses its existing
read-only ledger capabilities; training-only read access to checkout
reconciliation must be explicit and grant no spending, issuing, reversing or
store-access administration rights. Store operator receives only the dummy
store grant.

## Proposed code areas (not changed)

| Area | Files |
|---|---|
| Database context and safe training connection | `lib/db/src/index.ts`; new training connection/context modules and schema definitions under `lib/db/src/` |
| Tenant admission, sessions, control/reset and outbox | `artifacts/api-server/src/app.ts`, `routes/index.ts`, `lib/auth.ts`; new focused training middleware/routes/services |
| Fail-closed side-effect gateways | `artifacts/api-server/src/lib/email.ts`, `lib/objectStorage.ts`, `routes/storage.ts` |
| Reused workflow boundaries and audit scoping | `routes/redemptions.ts`, `routes/storeGiftCards.ts`, `routes/transactions.ts`, plus every handler importing the shared database |
| Contract and generated clients | `lib/api-spec/openapi.yaml`, then generated API/Zod packages via existing codegen |
| Entry, banner and real workflow reuse | `artifacts/legend-bucks/src/App.tsx`, `components/layout/Shell.tsx`, new training control/outbox pages |
| Browser isolation | `artifacts/legend-bucks/src/lib/auth-token.ts`, `lib/store-card.ts`, `lib/api-client-react/src/custom-fetch.ts`, frontend bootstrap/cache helpers |
| Verification | New production-safe training isolation/API test suite and browser acceptance coverage; retain development sandbox tests and guard |

## Provisioning blocker and resolution

There is no configured isolated production training data boundary to validate.
Creating or seeding one through current owner-backed application routes would
violate the requested safety boundary. This is a missing provisioning and review
step, **not a claim that Replit cannot host this design**.

An authorized database administrator must review and arrange a training-only
schema/role connection (or a separate database connection in the same project),
with explicit denial of live-data access. Add its credential through Secrets,
never chat. For the managed database, review the development-to-production
schema diff and backup/recovery plan before any user-controlled Publish.
Role/grant provisioning requires its own reviewed procedure; do not assume
Publish creates the required security grants. No agent startup migration,
production `db push`, fixture suite or demo bootstrap is authorized.

After provisioning is settled, implement and verify against an isolated
development training target before considering a reviewed deployment. No
production seed or migration was attempted in this assessment.

## Required acceptance checks — all pending

- Admin admission, enable/disable, reset authorization and session revocation.
- Dummy role UI/API coverage including manager denial of gift approval/issuance.
- Dummy request, separate approval and issuance, and simulated outbox delivery.
- Starting CAD balance, partial spend, unique training receipt, fresh remaining
  balance and matching accounting audit entry.
- Duplicate submission rejection without a second debit; concurrent spends
  cannot exceed the card balance.
- Bidirectional session rejection, forged mode flags, colliding entity IDs,
  live-code rejection, exports, caches and asset-access isolation.
- Parallel training/live requests do not cross contexts. Missing configuration,
  schema, seed or broken privileges fail closed.
- Mail/storage/integration transports are never called from training.
- Reset during pending checkout cannot mutate another tenant or allow stale
  capabilities to spend reseeded cards.
- Normal-role permissions and portal workflow regressions in isolated tests.
- No full bearer codes in screenshots, logs, URLs, exports or diagnostic output.

Previous live gift-card API checks do not prove this new training boundary.
Training results do not approve real POS tender or Accounting treatment.
