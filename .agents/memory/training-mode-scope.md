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
