# Store gift card API contract (base `/api`)

All endpoints use the signed-in portal session. Monetary fields are **integer CAD cents**; the UI converts decimal dollars to cents exactly. Store access is an explicit `(employeeId, storeId)` grant, independent of portal role. The employee must remain active and assigned to the store's active location. No full code appears in a GET, URL, response, receipt, or audit result.

| Method and path | Access | Request | Success |
| --- | --- | --- | --- |
| GET `/store-gift-cards/status` | signed in | — | `{enabled:boolean,sandbox:boolean}` |
| GET `/stores` | admin | — | `Store[]` |
| POST `/stores` | admin | `{name:string,locationId:number}` | `Store` |
| GET `/stores/access` | admin | — | `StoreAccess[]` |
| POST `/stores/access` | admin | `{storeId:number,employeeId:number}` | `StoreAccess` |
| DELETE `/stores/access/{storeId}/{employeeId}` | admin | — | 204 |
| GET `/store-gift-cards/my-stores` | signed in | — | `Store[]` (only active grants) |
| GET `/store-gift-cards/transactions?limit=50&offset=0` | admin | optional bounded limit (1–100), offset (>=0) | newest-first `StoreCardTransaction[]` (spend and reversal audit; includes transactionRef, kind, maskedCode, storeId/storeName, employeeId/employeeName, amountCents, previousBalanceCents, newBalanceCents, receiptRef or null, originalTransactionRef or null, reason or null, createdAt) |
| POST `/store-gift-cards/lookup` | active granted employee | `{storeId:number,code:string}` in JSON body ONLY | `{cardId:number,lookupToken:string(UUID),maskedCode:string,status:"emailed",balanceCents:number}` |
| POST `/store-gift-cards/spend` | active granted employee | `{storeId:number,cardId:number,lookupToken:string(UUID),amountCents:number,receiptRef:string,idempotencyKey:string(UUID)}` | `{transactionRef:string,cardId:number,maskedCode:string,previousBalanceCents:number,newBalanceCents:number,amountCents:number,receiptRef:string,createdAt:string}` |
| POST `/store-gift-cards/reverse` | admin | `{transactionRef:string,reason:string,idempotencyKey:string(UUID)}` | original spend transaction fields plus `{reversalRef:string,reversedAt:string}`; `previousBalanceCents`/`newBalanceCents` are the **reversal's** restored before/after balance (not the original deduction). |

`Store` is `{id,name,locationId,active}`. `StoreAccess` is `{storeId,employeeId}`. Non-sandbox usage defaults disabled unless `STORE_GIFT_CARDS_ENABLED=true`; sandbox development is enabled. Disabled status is readable, monetary operations return 403. Spends return 409 on insufficient funds, receipt reuse, or conflicting idempotency key; identical retries return the original success after authorization/gate recheck. Receipt refs are unique case-insensitively per store (trimmed); a reversed spend still occupies its receipt. Reversals never credit Legend Bucks. Card lookup/spend requires `status=emailed`, `emailedAt` present, not voided. Admin issue/reissue/void and rejection cannot bypass spending-history checks.

Keep `lookupToken` from a successful lookup in memory/session state for confirmation and network retries: it is a 30-minute opaque, employee/store/card-bound capability, not the bearer card code. If expired, scan/lookup again and retry with the original idempotency key. Do not put the token in URLs or logs.

Migration: new ledger rows are not fabricated for pre-existing cards. Their immutable `gift_card_issues.cad_value_cents` remains the initial balance until the first store ledger row; no conversion/backfill modifies face value.