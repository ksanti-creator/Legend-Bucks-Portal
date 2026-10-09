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
