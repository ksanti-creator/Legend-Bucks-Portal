# In-store gift card checkout and reconciliation — draft for admin review

## Release hold

Real store use is disabled by default. Do not publish or enable it until the automated tests pass and a portal admin reviews this procedure. Development sandbox transactions are simulated and are not proof of a successful production checkout, email delivery, or migration.

There is no Salesforce connection and no external point-of-sale integration. The portal is the source of truth for the remaining CAD balance. The store receipt remains the store's sale record.

## Access

An admin creates a store for an existing active location, then explicitly grants access to an active employee assigned to that location. A manager title or ordinary portal login is not permission to check or spend a card. Revoke access when duties or location change.

Gift-card request approval and issuance are separate admin-only actions. A card is spendable only after successful email delivery and while unvoided.

## Checkout

1. Sign in using your own account and open In-Store Gift Cards. Select your authorized store.
2. Scan with a keyboard-input scanner, or enter the card code into the protected code field. Never put the code into a receipt, comment, URL, screenshot, or support message.
3. Check the masked code, card status, and available CAD balance. Do not rely on the original face value printed in the email.
4. Enter the CAD amount being charged and the store's receipt reference. Each receipt reference can be used only once per store, including after reversal.
5. Review the amount, receipt, and resulting balance before recording the spend.
6. Wait for the portal's success result. Record its transaction reference against the store receipt, never the full card code.
7. If the response times out, use the pending transaction's retry action. Do not start another charge or change the receipt to bypass a duplicate warning. An identical retry returns the original transaction, not another deduction.
8. A card may be used again for its remaining balance. Insufficient funds must be resolved by reducing the purchase/card amount or using another payment method; staff cannot edit balances.

## Corrections

Only an admin may reverse a recorded spend. Use the original portal transaction reference and a meaningful reason, then confirm. The reversal restores the CAD value on the card and preserves the original transaction and reversal audit trail. It does not refund Legend Bucks.

A reversal is not deletion. Do not reuse the reversed receipt reference for another spend. Use the store's correction/replacement receipt process and reconcile both references.

Voiding or reissuing cards with any spending history is blocked, including fully reversed history. Escalate lost or compromised spent cards to an admin; do not work around this restriction by issuing replacement value manually.

## Daily reconciliation

An admin reviews the store-card transaction audit against store receipts:

- Match store, receipt, employee, amount in CAD, timestamp, and portal transaction reference.
- Account for each reversal against its original spend and reason.
- Confirm opening card value minus recorded spends plus reversals equals the remaining balance.
- Investigate missing receipts, duplicate attempts, unresolved timeouts, and unexpected employee/store assignments.
- Retain reconciliation evidence without full card codes.

## Required review before real use

- Confirm who grants access, records spends, performs reversals, and signs off daily reconciliation.
- Confirm the receipt-reference convention, including whether the POS resets receipt numbers.
- Review migration/schema changes and verify existing issued-card face values remain unchanged.
- Confirm real-store enablement remains off during deployment checks.
- Verify deployed authentication, permission revocation, disabled rollout behavior, and schema compatibility.
- Validate the actual store scanner/browser, network interruption/retry behavior, and a supervised checkout after explicit launch approval.
- Record the reviewing admin and approval date outside source code before enabling real use.

Camera scanning, external POS reconciliation, and automated BambooHR/Salesforce updates are not part of this tool.