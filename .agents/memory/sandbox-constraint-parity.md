---
name: Sandbox constraint parity
description: Why successful table cloning does not prove deletion behavior matches the regular schema
---

When a deletion test fails only in an isolated clone, compare its actual foreign keys with the intended schema before changing application behavior. PostgreSQL `LIKE INCLUDING ALL` does not copy foreign keys.

**Why:** Missing clone constraints can mimic application bugs, and adding manual child deletion would conceal the mismatch instead of testing the real database behavior.

**How to apply:** Recreate only sandbox-local references. If prior runs left rows with unknown ownership, do not delete them as test cleanup. A `NOT VALID` foreign key can enforce subsequent writes and parent deletion while preserving old orphans for a separately authorized cleanup.