---
name: Sandbox publishing isolation
description: Production needs explicit false sandbox flags, not just absent production overrides.
---

Keep production sandbox flags explicitly false; do not weaken the fail-closed sandbox guard to make publishing succeed.

**Why:** A publish compiled successfully but its server stopped at the sandbox guard despite production environment inspection showing no explicit sandbox override. Starting the same bundle with sandbox explicitly false passed its health check.

**How to apply:** When diagnosing startup failures after sandbox work, distinguish build success from server startup. Check production overrides and retain separate checkout rollout gating. Absence of an override is not evidence of the effective runtime value.