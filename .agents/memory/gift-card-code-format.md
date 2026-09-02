---
name: Gift card code format
description: Security decision for customer-facing Legend Bucks gift card codes.
---

Use seven groups of four base-32 characters after the `LBGC-` prefix, providing 140 bits of entropy. Do not shorten the code to four groups.

**Why:** The user explicitly chose the secure format after reviewing the mathematical conflict: four base-32 groups provide only 80 bits and cannot satisfy the minimum 128-bit bearer-code requirement.

**How to apply:** Keep generation, masking, recipient email rendering, QR payloads, and tests aligned to the seven-group format.