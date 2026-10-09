---
name: In-project training scope
description: Owner's required architecture and hard isolation boundaries for Legend Bucks training
---

Training belongs inside the existing Legend Bucks portal and deployment, not a
new Replit project or imported copy. The owner explicitly superseded the isolated
demo ZIP with this requirement on 2026-10-09.

**Why:** Staff need the real manager, admin, Accounting and Store workflows in
one portal while practising exclusively with dummy data.

**How to apply:** Require an isolated training database/schema and separate
server-verified sessions; never use a demo column in live ledgers or enable the
development sandbox in production. Block real outbound notifications,
integrations and storage; use a simulated outbox. Display
`TRAINING — DUMMY DATA` throughout. Reset only training data. Production
migration/backup review is separate; no production fixture tests or automatic
seed. Preserve normal-mode permissions and do not treat training as real-tender
or Accounting approval.

## Training database authorization

Use a dedicated training-only Neon account or project and a fresh empty
database, never a production branch or copy. Preserve the live `DATABASE_URL`;
keep the restricted training connection only in Secrets as
`TRAINING_DATABASE_URL`. Keep `/training` disabled until isolation, role and
spend tests pass.

**Why:** The owner requires the integration's requested permissions and evidence
that it cannot reach live Legend Bucks data before authorizing it.

**How to apply:** Do not equate a project name or a promised usage restriction
with permission isolation. Distinguish documented provider capabilities from
the actual consent scopes, and verify the authorized identity's resource access.
Never display connection strings or place them in code or chat.

The owner subsequently chose manual Neon provisioning because no consent screen
was available. Do not authorize the Neon integration. The owner will add the
restricted credential directly to Replit Secrets; do not request it in chat.

## Neon password initialization

A restricted role created through SQL must have an initial password before
instructing the owner to use Neon's Console password reset.

**Why:** The Console rejected a passwordless SQL-created role with
`cannot update password for role without password`.

**How to apply:** Initialize a strong random password privately, without
returning it in tool output, then let the owner reset it in Neon and transfer
the resulting connection directly to Replit Secrets. Never use the elevated
Console role-creation shortcut to work around this limitation.

## Training schema ownership

Training-only schema definitions must not enter the normal database's migration
discovery path. Initialize the fresh training database through a guarded,
owner-run script; keep its runtime credential unable to create tables.

**Why:** Publishing normal application changes must never create training
metadata in the live database, or require elevating the training application.

**How to apply:** Keep training provisioning separate from publish/startup
hooks, preserve source-defined constraints rather than copying live tables,
and reject initialization of a non-empty database.

## Neon pooled-connection settings

Use transaction-local `search_path` settings rather than passing them as
connection startup options to the training endpoint.

**Why:** Adding startup `-c search_path` produced PostgreSQL code `08P01`;
the same connection succeeded with `SET LOCAL` inside a read-only transaction.

**How to apply:** Keep session-sensitive operations within a transaction and
avoid assumptions that settings survive transaction-pool connection reuse.

## Training admission and reset boundaries

Launching any dummy persona and resetting shared training data require an
active normal-portal administrator. A dummy administrator session cannot
authorize either operation against the normal portal.

**Why:** Offering an unrestricted dummy admin login would expose shared training
data/reset controls publicly; accepting training identities for admission would
erase the separation from normal authorization.

**How to apply:** Authenticate admission outside the training context, then
use only the dedicated training connection for business workflows. Hold a
shared transaction-scoped lock for each training request and an exclusive lock
for reset; buffer success until commit so reset cannot race an acknowledged spend.
