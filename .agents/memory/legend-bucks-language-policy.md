---
name: Bilingual content boundaries
description: Canadian French translation scope, recipient-language choices, and safe login preference handling.
---

Translate application-authored interface/email text, not arbitrary product descriptions, personal names, employee notes, or card codes.

**Why:** A language toggle must not rewrite business records or alter identifiers. Stored ledger notes can also be relied on by accounting logic, so localized representations belong in display formatting only.

**How to apply:** New features need English and Canadian French system copy and locale-aware formatting. Keep data values intact. Emails follow the recipient's saved language, not the initiating admin's; external gift-card recipients fall back to the purchaser's language, and an unmatched fixed payroll mailbox defaults to English.

Do not persist an unauthenticated sign-in language choice to an employee until the sign-in link/code is verified.

**Why:** Otherwise anyone who knows an employee email could change that employee's preference.

**How to apply:** A selected guest language may control that sign-in email, but authenticated preference changes remain self-scoped.