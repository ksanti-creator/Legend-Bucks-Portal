import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, sandboxEnabled, storesTable, storeAccessTable, storeCardLedgerTable, storeCardLookupTokensTable, giftCardIssuesTable, employeesTable, locationsTable } from "@workspace/db";
import {
  GetStoreGiftCardStatusResponse, ListStoresResponse, CreateStoreBody, CreateStoreResponse,
  ListStoreAccessResponse, GrantStoreAccessBody, GrantStoreAccessResponse, RevokeStoreAccessParams,
  ListMyStoresResponse, ListStoreGiftCardTransactionsQueryParams, ListStoreGiftCardTransactionsResponse,
  LookupStoreGiftCardBody, LookupStoreGiftCardResponse,
  SpendStoreGiftCardBody, SpendStoreGiftCardResponse, ReverseStoreGiftCardSpendBody, ReverseStoreGiftCardSpendResponse,
} from "@workspace/api-zod";
import { getCurrentUser, requireAuth } from "../lib/auth";
import { hashGiftCardCode, maskGiftCardCode } from "../lib/giftCards";

const router: IRouter = Router();
const activeAdmin = (req: import("express").Request) => {
  const user = getCurrentUser(req);
  return user.role === "admin" && user.status === "active";
};
const enabled = () => sandboxEnabled() || process.env.STORE_GIFT_CARDS_ENABLED === "true";
const codePattern = /LBGC[-\s]?(?:[A-HJ-NP-Z2-9]{4}[-\s]?){6}[A-HJ-NP-Z2-9]{4}/i;
const forbiddenText = (value: string) => codePattern.test(value) || /LBGC/i.test(value);
const validText = (value: string, limit: number) => value.trim().length > 0 && value.trim().length <= limit && !forbiddenText(value);
const safeCard = (card: typeof giftCardIssuesTable.$inferSelect) =>
  card.status === "emailed" && card.emailedAt !== null && card.voidedAt === null;
const issueMask = (card: typeof giftCardIssuesTable.$inferSelect) => maskGiftCardCode(card.codeLast4);

// Lock all authorization rows until the balance transaction commits. A revoked
// grant, deactivated employee, or deactivated store cannot race past checkout.
async function access(trx: Parameters<Parameters<typeof db.transaction>[0]>[0], employeeId: number, storeId: number) {
  const result = await trx.execute(sql`
    SELECT s.id FROM store_access a
    JOIN stores s ON s.id=a.store_id
    JOIN employees e ON e.id=a.employee_id
    WHERE a.employee_id=${employeeId} AND a.store_id=${storeId}
      AND e.status='active' AND s.active=true AND e.location_id=s.location_id
    FOR SHARE OF a, s, e`);
  return result.rows.length > 0;
}
const lockedCard = async (trx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: number) => {
  // Shares advisory lock key with issue, reissue, void and rejection.
  const [card] = await trx.select().from(giftCardIssuesTable).where(eq(giftCardIssuesTable.id, id)).limit(1);
  if (!card) return null;
  await trx.execute(sql`SELECT pg_advisory_xact_lock(${card.redemptionId})`);
  await trx.execute(sql`SELECT id FROM gift_card_issues WHERE id=${id} FOR UPDATE`);
  const [fresh] = await trx.select().from(giftCardIssuesTable).where(eq(giftCardIssuesTable.id, id)).limit(1);
  return fresh ?? null;
};
const balance = async (trx: Parameters<Parameters<typeof db.transaction>[0]>[0], card: typeof giftCardIssuesTable.$inferSelect) => {
  const [last] = await trx.select().from(storeCardLedgerTable).where(eq(storeCardLedgerTable.cardId, card.id))
    .orderBy(desc(storeCardLedgerTable.id)).limit(1);
  return last ? last.newBalanceCents : card.cadValueCents;
};
const spendOutput = (row: typeof storeCardLedgerTable.$inferSelect, card: typeof giftCardIssuesTable.$inferSelect) => ({
  transactionRef: row.transactionRef,
  cardId: row.cardId,
  maskedCode: issueMask(card),
  previousBalanceCents: row.previousBalanceCents,
  newBalanceCents: row.newBalanceCents,
  amountCents: row.amountCents,
  receiptRef: row.receiptRef ?? "",
  createdAt: row.createdAt.toISOString(),
});
class CheckoutError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function failure(res: import("express").Response, error: unknown) {
  // Never serialize DB errors or validation errors; they can include bearer code
  // values or SQL parameter payloads.
  if (error instanceof CheckoutError) res.status(error.status).json({ error: error.message });
  else if (isUniqueViolation(error))
    res.status(409).json({ error: "Receipt or idempotency key already used" });
  else res.status(500).json({ error: "Store gift card operation failed" });
}
function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}
router.get("/store-gift-cards/status", requireAuth, async (_req, res): Promise<void> => {
  res.json(GetStoreGiftCardStatusResponse.parse({ enabled: enabled(), sandbox: sandboxEnabled() }));
});
router.get("/stores", requireAuth, async (req, res): Promise<void> => {
  if (!activeAdmin(req)) { res.sendStatus(403); return; }
  res.json(ListStoresResponse.parse(await db.select().from(storesTable)));
});
router.post("/stores", requireAuth, async (req, res): Promise<void> => {
  if (!activeAdmin(req)) { res.sendStatus(403); return; }
  const body = CreateStoreBody.safeParse(req.body);
  if (!body.success || !validText(body.data.name, 100)) { res.status(400).json({ error: "Invalid store" }); return; }
  const [location] = await db.select().from(locationsTable).where(eq(locationsTable.id, body.data.locationId)).limit(1);
  if (!location) { res.status(400).json({ error: "Invalid location" }); return; }
  const [store] = await db.insert(storesTable).values({ name: body.data.name.trim(), locationId: location.id }).returning();
  res.status(201).json(CreateStoreResponse.parse(store));
});
router.get("/stores/access", requireAuth, async (req, res): Promise<void> => {
  if (!activeAdmin(req)) { res.sendStatus(403); return; }
  res.json(ListStoreAccessResponse.parse(await db.select().from(storeAccessTable)));
});
router.post("/stores/access", requireAuth, async (req, res): Promise<void> => {
  if (!activeAdmin(req)) { res.sendStatus(403); return; }
  const body = GrantStoreAccessBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid grant" }); return; }
  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, body.data.storeId));
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, body.data.employeeId));
  if (!store?.active || employee?.status !== "active" || store.locationId !== employee.locationId) {
    res.status(400).json({ error: "Employee must be active and assigned to this store location" }); return;
  }
  const [grant] = await db.insert(storeAccessTable).values(body.data).onConflictDoNothing().returning();
  res.status(201).json(GrantStoreAccessResponse.parse(grant ?? body.data));
});
router.delete("/stores/access/:storeId/:employeeId", requireAuth, async (req, res): Promise<void> => {
  if (!activeAdmin(req)) { res.sendStatus(403); return; }
  const params = RevokeStoreAccessParams.safeParse(req.params);
  if (!params.success) { res.sendStatus(400); return; }
  await db.delete(storeAccessTable).where(and(eq(storeAccessTable.storeId, params.data.storeId), eq(storeAccessTable.employeeId, params.data.employeeId)));
  res.sendStatus(204);
});
router.get("/store-gift-cards/my-stores", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (!enabled() || user.status !== "active") { res.json(ListMyStoresResponse.parse([])); return; }
  const stores = await db.select({ id: storesTable.id, name: storesTable.name, locationId: storesTable.locationId, active: storesTable.active })
    .from(storeAccessTable).innerJoin(storesTable, eq(storesTable.id, storeAccessTable.storeId))
    .where(and(eq(storeAccessTable.employeeId, user.id), eq(storesTable.active, true), eq(storesTable.locationId, user.locationId ?? -1)));
  res.json(ListMyStoresResponse.parse(stores));
});
router.get("/store-gift-cards/transactions", requireAuth, async (req, res): Promise<void> => {
  if (!activeAdmin(req)) { res.sendStatus(403); return; }
  const parsed = ListStoreGiftCardTransactionsQueryParams.safeParse(req.query);
  if (!parsed.success || (parsed.data.limit !== undefined && !Number.isSafeInteger(parsed.data.limit)) ||
    (parsed.data.offset !== undefined && !Number.isSafeInteger(parsed.data.offset))) {
    res.status(400).json({ error: "Invalid pagination" }); return;
  }
  const rows = await db.select({
    entry: storeCardLedgerTable,
    card: giftCardIssuesTable,
    storeName: storesTable.name,
    firstName: employeesTable.firstName,
    lastName: employeesTable.lastName,
  }).from(storeCardLedgerTable)
    .innerJoin(giftCardIssuesTable, eq(storeCardLedgerTable.cardId, giftCardIssuesTable.id))
    .innerJoin(storesTable, eq(storeCardLedgerTable.storeId, storesTable.id))
    .innerJoin(employeesTable, eq(storeCardLedgerTable.employeeId, employeesTable.id))
    .orderBy(desc(storeCardLedgerTable.id)).limit(parsed.data.limit ?? 50).offset(parsed.data.offset ?? 0);
  const originalIds = rows.flatMap(({ entry }) => entry.originalSpendId === null ? [] : [entry.originalSpendId]);
  const originals = originalIds.length ? await db.select({ id: storeCardLedgerTable.id, ref: storeCardLedgerTable.transactionRef })
    .from(storeCardLedgerTable).where(inArray(storeCardLedgerTable.id, originalIds)) : [];
  const refById = new Map(originals.map(x => [x.id, x.ref]));
  res.json(ListStoreGiftCardTransactionsResponse.parse(rows.map(({ entry, card, storeName, firstName, lastName }) => ({
    transactionRef: entry.transactionRef,
    kind: entry.kind,
    cardId: entry.cardId,
    maskedCode: issueMask(card),
    storeId: entry.storeId,
    storeName,
    employeeId: entry.employeeId,
    employeeName: `${firstName} ${lastName}`.trim(),
    amountCents: entry.amountCents,
    previousBalanceCents: entry.previousBalanceCents,
    newBalanceCents: entry.newBalanceCents,
    receiptRef: entry.receiptRef,
    originalTransactionRef: entry.originalSpendId === null ? null : (refById.get(entry.originalSpendId) ?? null),
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
  }))));
});
router.post("/store-gift-cards/lookup", requireAuth, async (req, res): Promise<void> => {
  const body = LookupStoreGiftCardBody.safeParse(req.body);
  if (!body.success || !/^LBGC-(?:[A-HJ-NP-Z2-9]{4}-){6}[A-HJ-NP-Z2-9]{4}$/.test(body.data.code)) {
    res.status(400).json({ error: "Invalid card code" }); return;
  }
  if (!enabled()) { res.sendStatus(403); return; }
  try {
    const result = await db.transaction(async (trx) => {
      if (!await access(trx, getCurrentUser(req).id, body.data.storeId)) throw new CheckoutError(403, "Store access required");
      const [matched] = await trx.select({ id: giftCardIssuesTable.id }).from(giftCardIssuesTable)
        .where(eq(giftCardIssuesTable.codeHash, hashGiftCardCode(body.data.code))).limit(1);
      const card = matched ? await lockedCard(trx, matched.id) : null;
      if (!card || !safeCard(card)) throw new CheckoutError(404, "Card not available");
      const lookupToken = randomUUID();
      await trx.insert(storeCardLookupTokensTable).values({
        tokenHash: hashGiftCardCode(lookupToken), cardId: card.id,
        storeId: body.data.storeId, employeeId: getCurrentUser(req).id,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      });
      return { cardId: card.id, lookupToken, maskedCode: issueMask(card), status: "emailed", balanceCents: await balance(trx, card) };
    });
    res.json(LookupStoreGiftCardResponse.parse(result));
  } catch (error) { failure(res, error); }
});
router.post("/store-gift-cards/spend", requireAuth, async (req, res): Promise<void> => {
  const body = SpendStoreGiftCardBody.safeParse(req.body);
  if (!body.success || !Number.isSafeInteger(body.data.amountCents) || !validText(body.data.receiptRef, 100)) {
    res.status(400).json({ error: "Invalid spend" }); return;
  }
  if (!enabled()) { res.sendStatus(403); return; }
  const receiptRef = body.data.receiptRef.trim();
  const receiptNormalized = receiptRef.toLocaleLowerCase("en-CA");
  try {
    const result = await db.transaction(async (trx) => {
      const actor = getCurrentUser(req).id;
      if (!await access(trx, actor, body.data.storeId)) throw new CheckoutError(403, "Store access required");
      const [proof] = await trx.select({ id: storeCardLookupTokensTable.id }).from(storeCardLookupTokensTable)
        .where(and(eq(storeCardLookupTokensTable.tokenHash, hashGiftCardCode(body.data.lookupToken)),
          eq(storeCardLookupTokensTable.employeeId, actor),
          eq(storeCardLookupTokensTable.storeId, body.data.storeId),
          eq(storeCardLookupTokensTable.cardId, body.data.cardId),
          sql`${storeCardLookupTokensTable.expiresAt} > NOW()`)).limit(1);
      if (!proof) throw new CheckoutError(403, "Scan this card before checkout");
      const card = await lockedCard(trx, body.data.cardId);
      if (!card || !safeCard(card)) throw new CheckoutError(404, "Card not available");
      const [existing] = await trx.select().from(storeCardLedgerTable).where(and(
        eq(storeCardLedgerTable.employeeId, actor), eq(storeCardLedgerTable.storeId, body.data.storeId),
        eq(storeCardLedgerTable.idempotencyKey, body.data.idempotencyKey),
      )).limit(1);
      if (existing) {
        if (existing.kind !== "spend" || existing.cardId !== card.id || existing.amountCents !== body.data.amountCents ||
            existing.receiptRef !== receiptRef) throw new CheckoutError(409, "Idempotency key conflicts with another request");
        return spendOutput(existing, card);
      }
      const [usedReceipt] = await trx.select({ id: storeCardLedgerTable.id }).from(storeCardLedgerTable)
        .where(and(eq(storeCardLedgerTable.storeId, body.data.storeId),
          eq(storeCardLedgerTable.receiptNormalized, receiptNormalized), eq(storeCardLedgerTable.kind, "spend"))).limit(1);
      if (usedReceipt) throw new CheckoutError(409, "Receipt reference already used at this store");
      const previous = await balance(trx, card);
      if (body.data.amountCents > previous) throw new CheckoutError(409, "Insufficient card balance");
      const [row] = await trx.insert(storeCardLedgerTable).values({
        transactionRef: randomUUID(), cardId: card.id, storeId: body.data.storeId, employeeId: actor,
        kind: "spend", amountCents: body.data.amountCents, previousBalanceCents: previous,
        newBalanceCents: previous - body.data.amountCents, receiptRef, receiptNormalized,
        idempotencyKey: body.data.idempotencyKey,
      }).returning();
      return spendOutput(row, card);
    });
    res.json(SpendStoreGiftCardResponse.parse(result));
  } catch (error) { failure(res, error); }
});
router.post("/store-gift-cards/reverse", requireAuth, async (req, res): Promise<void> => {
  if (!activeAdmin(req)) { res.sendStatus(403); return; }
  const body = ReverseStoreGiftCardSpendBody.safeParse(req.body);
  if (!body.success || !validText(body.data.reason, 500)) { res.status(400).json({ error: "Invalid reversal" }); return; }
  if (!enabled()) { res.sendStatus(403); return; }
  try {
    const result = await db.transaction(async (trx) => {
      const [original] = await trx.select().from(storeCardLedgerTable).where(eq(storeCardLedgerTable.transactionRef, body.data.transactionRef)).limit(1);
      if (!original || original.kind !== "spend") throw new CheckoutError(404, "Spend not found");
      const card = await lockedCard(trx, original.cardId);
      if (!card) throw new CheckoutError(404, "Card not available");
      const [existing] = await trx.select().from(storeCardLedgerTable).where(eq(storeCardLedgerTable.originalSpendId, original.id)).limit(1);
      if (existing) {
        if (existing.employeeId !== getCurrentUser(req).id || existing.idempotencyKey !== body.data.idempotencyKey ||
          existing.reason !== body.data.reason.trim()) throw new CheckoutError(409, "Spend already reversed");
        return { ...spendOutput(original, card), previousBalanceCents: existing.previousBalanceCents,
          newBalanceCents: existing.newBalanceCents, reversalRef: existing.transactionRef, reversedAt: existing.createdAt.toISOString() };
      }
      const previous = await balance(trx, card);
      const [reversal] = await trx.insert(storeCardLedgerTable).values({
        transactionRef: randomUUID(), cardId: card.id, storeId: original.storeId,
        employeeId: getCurrentUser(req).id, kind: "reversal",
        amountCents: original.amountCents, previousBalanceCents: previous,
        newBalanceCents: previous + original.amountCents, idempotencyKey: body.data.idempotencyKey,
        originalSpendId: original.id, reason: body.data.reason.trim(),
      }).returning();
      return { ...spendOutput(original, card), previousBalanceCents: reversal.previousBalanceCents,
        newBalanceCents: reversal.newBalanceCents, reversalRef: reversal.transactionRef, reversedAt: reversal.createdAt.toISOString() };
    });
    res.json(ReverseStoreGiftCardSpendResponse.parse(result));
  } catch (error) { failure(res, error); }
});
export default router;