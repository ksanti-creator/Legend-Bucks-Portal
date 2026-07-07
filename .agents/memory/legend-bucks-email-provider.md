---
name: Legend Bucks email provider
description: Which email provider Legend Bucks sends transactional mail through, and why.
---

# Legend Bucks email provider

Transactional email (magic-link sign-in + employee invites) sends via the **Gmail**
connector (`google-mail`), not Resend.

**Why:** The Resend connection's API key was persistently invalid (Resend returned
401 "API key is invalid" even after re-authorizing twice), and no one on the team
could confirm who owned/created that Resend account. Switched to Gmail, which sends
from the authorized Workspace account.

**How to apply:**
- Email code lives in one module and calls the Gmail send endpoint
  (`POST /gmail/v1/users/me/messages/send`) with a base64url-encoded RFC 2822 message.
- Gmail sends *from the authenticated account*; a `From` header is only honored if it
  matches that account or a configured "send as" alias. A `GMAIL_FROM` env var supplies
  the display-name From when it points at the connected account.
- Recipients can be any domain — only the *sender* address is constrained by the provider.
- If re-adding Resend or another provider later, expect the same two requirements:
  a valid API key and a verified sending domain/address.
