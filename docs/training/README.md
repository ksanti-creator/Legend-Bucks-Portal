# In-project Training Mode

## Release boundary

`/training` is the launcher in the existing Legend Bucks app.
`TRAINING_MODE_ENABLED` is a **server-side, default-off** release switch.
Do not enable it in the published service until acceptance is approved and the
restricted training secret is available in that service. No publish or live
database migration is part of this implementation.

`DATABASE_URL`, the sandbox production guard, and the live store-checkout flag
remain unchanged. There is no Neon MCP, link, deploy, or environment-file setup.

## Identity and isolation

- Only an active normal-portal admin can launch dummy roles or reset training.
- Dummy roles: administrator, manager, employee, Accounting Admin and store operator.
- Training bearer sessions are two-hour, generation-scoped tokens kept in browser
  sessionStorage, separate from the normal login. Reset revokes all of them.
- Each request uses a verified, restricted connection to the dedicated
  `legend_bucks_training` database and an isolated transaction context.
- Requests hold shared transaction locks; reset holds the exclusive lock.
  Nested domain transactions use savepoints. Responses wait for commit.
- Normal-pool access throws within training. Tokens are rejected across modes
  before normal data is queried. Missing config/schema/seed returns unavailable.
- Routes are allow-listed. Unknown endpoints, real authentication flows, storage,
  external photo URLs and non-dummy recipient addresses are blocked.
- Notifications write a simulated outbox instead of reaching Gmail.
  Gift cards use non-bearer `TRAINING-CARD-<id>` aliases at the training till.
  No full codes, QR codes, login links or email bodies are saved in the outbox.
- Reset deletes only training data, preserves the reset audit, and does not reuse IDs.

The launcher necessarily checks the normal administrator's session for admission;
the training portal's business reads and writes do not use normal data.

## Operation

Once released, sign into the normal portal as admin and visit `/training`.
Initialize dummy data if needed, choose a persona, and practice with the existing
portal screens. Use Change persona to switch roles. Use Exit training to return
to the normal portal. Admin and Accounting personas can see the simulated outbox.
The operator has the sole initial explicit training till grant.

## Verification

Read-only provisioning check:

```sh
pnpm --filter @workspace/scripts run training:verify
```

**Destructive to dummy training data only:** the following opt-in suite resets
training before and after testing. Do not run while staff are practising.

```sh
pnpm --filter @workspace/api-server run test:training
```

The suite never imports the development sandbox fixture tests. It uses in-memory
admission principals and asserts zero normal-pool and Gmail connector calls.
It covers cross-mode auth, admin admission, disabled/missing configuration,
unknown routes, real recipients/storage rejection, manager awards, Accounting
read-only access, approval and separate issue, simulated outbox, explicit till
access, partial spend, idempotent retry, duplicate receipt rejection, concurrent
spends, remaining balances, admin reconciliation, and session revocation.

API tests establish server behavior; browser testing separately checks the
real multi-persona workflow. Neither is evidence of deployment or real email delivery.
