import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, storesTable, storeAccessTable, storeCardLookupTokensTable, storeCardLedgerTable, giftCardIssuesTable, redemptionsTable, rewardsTable, transactionsTable, employeesTable } from "@workspace/db";
import { Fixtures, bearer, uniq } from "./helpers";
import { generateGiftCardCode, hashGiftCardCode } from "../lib/giftCards";

vi.mock("../lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/email")>(),
  sendGiftCardRecipientEmail: vi.fn().mockResolvedValue(undefined),
  sendNewRedemptionRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendRedemptionReceiptEmail: vi.fn().mockResolvedValue(undefined),
}));
import app from "../app";

const fx = new Fixtures();
let admin: Awaited<ReturnType<Fixtures["createAuthedEmployee"]>>;
let staff: Awaited<ReturnType<Fixtures["createAuthedEmployee"]>>;
let other: Awaited<ReturnType<Fixtures["createAuthedEmployee"]>>;
let manager: Awaited<ReturnType<Fixtures["createAuthedEmployee"]>>;
let store1: number;
let store2: number;
let rewardId: number;
const redemptions: number[] = [];
const cardIds: number[] = [];
const debitIds: number[] = [];
const codes = new Map<number, string>();
const proofs = new Map<string, string>();
const auth = (token: string) => bearer(token);
const post = (token: string, path: string, data: object) => request(app).post(`/api${path}`).set(auth(token)).send(data);
const spend = async (token: string, cardId: number, storeId: number, amountCents: number, receiptRef = uniq("receipt"), idempotencyKey = randomUUID()) => {
  const proofKey = `${token}:${cardId}:${storeId}`;
  if (!proofs.has(proofKey) && codes.has(cardId)) {
    const lookup = await post(token, "/store-gift-cards/lookup", { storeId, code: codes.get(cardId) });
    if (lookup.status === 200) proofs.set(proofKey, lookup.body.lookupToken);
  }
  return post(token, "/store-gift-cards/spend", {
    cardId, storeId, amountCents, receiptRef, idempotencyKey, lookupToken: proofs.get(proofKey) ?? randomUUID(),
  });
};
async function dummyCard(status: "emailed" | "voided" | "email_failed" | "pending_issue" = "emailed") {
  const code = generateGiftCardCode();
  const [r] = await db.insert(redemptionsTable).values({
    employeeId: staff.emp.id, rewardId, status: "fulfilled", buckCost: 300,
    giftCardLbAmount: 300, giftCardCadValueCents: 3000,
    giftCardRecipientName: "Test", giftCardRecipientEmail: "dummy@example.test",
  }).returning();
  redemptions.push(r.id);
  const [card] = await db.insert(giftCardIssuesTable).values({
    redemptionId: r.id, codeHash: hashGiftCardCode(code), codeLast4: code.slice(-4),
    recipientName: "Test", recipientEmail: "dummy@example.test", lbAmount: 300,
    cadValueCents: 3000, status, issuedByEmployeeId: admin.emp.id,
    emailedAt: status === "emailed" || status === "voided" ? new Date() : null,
    voidedAt: status === "voided" ? new Date() : null,
  }).returning();
  cardIds.push(card.id);
  codes.set(card.id, code);
  return { card, code, redemption: r };
}

describe("sandbox-only store gift card checkout", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "development" || process.env.LEGEND_BUCKS_SANDBOX !== "true")
      throw new Error("Store checkout tests require the isolated development sandbox");
    const location = await fx.createLocation();
    admin = await fx.createAuthedEmployee("admin", { locationId: location.id });
    staff = await fx.createAuthedEmployee("team_member", { locationId: location.id });
    other = await fx.createAuthedEmployee("team_member", { locationId: location.id });
    manager = await fx.createAuthedEmployee("manager", { locationId: location.id });
    const [reward] = await db.insert(rewardsTable).values({
      name: uniq("gift"), buckCost: 300, isCustomGiftCard: true, approvalRequired: false,
      giftCardIncrementLb: 100, giftCardMinimumLb: 100,
    }).returning();
    rewardId = reward.id;
    for (const name of ["Demo register A", "Demo register B"]) {
      const res = await post(admin.token, "/stores", { name, locationId: location.id });
      expect(res.status).toBe(201);
      if (!store1) store1 = res.body.id; else store2 = res.body.id;
    }
    for (const storeId of [store1, store2]) {
      expect((await post(admin.token, "/stores/access", { storeId, employeeId: staff.emp.id })).status).toBe(201);
    }
  });
  afterAll(async () => {
    if (cardIds.length) await db.delete(storeCardLookupTokensTable).where(inArray(storeCardLookupTokensTable.cardId, cardIds));
    if (cardIds.length) await db.delete(storeCardLedgerTable).where(inArray(storeCardLedgerTable.cardId, cardIds));
    await db.delete(storeAccessTable).where(inArray(storeAccessTable.storeId, [store1, store2]));
    if (cardIds.length) await db.delete(giftCardIssuesTable).where(inArray(giftCardIssuesTable.id, cardIds));
    if (redemptions.length) await db.delete(transactionsTable).where(inArray(transactionsTable.redemptionId, redemptions));
    if (debitIds.length) await db.delete(transactionsTable).where(inArray(transactionsTable.id, debitIds));
    if (redemptions.length) await db.delete(redemptionsTable).where(inArray(redemptionsTable.id, redemptions));
    await db.delete(storesTable).where(inArray(storesTable.id, [store1, store2]));
    if (rewardId) await db.delete(rewardsTable).where(eq(rewardsTable.id, rewardId));
    await fx.cleanup();
  });
  it("checks grant, card status, masks code, partially spends, rejects overdraft and retries safely", async () => {
    const { card, code } = await dummyCard();
    const denied = await post(other.token, "/store-gift-cards/lookup", { storeId: store1, code });
    expect(denied.status).toBe(403);
    const lookup = await post(staff.token, "/store-gift-cards/lookup", { storeId: store1, code });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toMatchObject({ cardId: card.id, balanceCents: 3000, status: "emailed" });
    expect(JSON.stringify(lookup.body)).not.toContain(code);
    expect((await post(staff.token, "/store-gift-cards/spend", {
      storeId: store1, cardId: card.id, lookupToken: randomUUID(), amountCents: 1,
      receiptRef: uniq(), idempotencyKey: randomUUID(),
    })).status).toBe(403);
    expect((await post(staff.token, "/store-gift-cards/spend", {
      storeId: store2, cardId: card.id, lookupToken: lookup.body.lookupToken, amountCents: 1,
      receiptRef: uniq(), idempotencyKey: randomUUID(),
    })).status).toBe(403);
    const key = randomUUID();
    const first = await spend(staff.token, card.id, store1, 1250, "Receipt-Abc", key);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ previousBalanceCents: 3000, newBalanceCents: 1750 });
    expect((await spend(staff.token, card.id, store1, 1250, "Receipt-Abc", key)).body.transactionRef).toBe(first.body.transactionRef);
    expect((await spend(staff.token, card.id, store1, 1251, "Receipt-Abc", key)).status).toBe(409);
    expect((await spend(staff.token, card.id, store1, 10, "receipt-abc")).status).toBe(409);
    expect((await spend(staff.token, card.id, store1, 1751)).status).toBe(409);
    expect((await spend(staff.token, card.id, store1, 1750)).body.newBalanceCents).toBe(0);
    expect((await spend(staff.token, card.id, store1, 1)).status).toBe(409);
    const reversed = await post(admin.token, "/store-gift-cards/reverse", {
      transactionRef: first.body.transactionRef, reason: "Wrong amount", idempotencyKey: key,
    });
    expect(reversed.status).toBe(200);
    expect(reversed.body).toMatchObject({ previousBalanceCents: 0, newBalanceCents: 1250, transactionRef: first.body.transactionRef });
    const audit = await request(app).get("/api/store-gift-cards/transactions?limit=100&offset=0").set(auth(admin.token));
    expect(audit.status).toBe(200);
    expect(audit.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ transactionRef: reversed.body.reversalRef, kind: "reversal",
        originalTransactionRef: first.body.transactionRef, reason: "Wrong amount", storeId: store1, employeeId: admin.emp.id }),
    ]));
    expect(JSON.stringify(audit.body)).not.toContain(code);
    expect((await request(app).get("/api/store-gift-cards/transactions").set(auth(staff.token))).status).toBe(403);
    expect((await post(admin.token, "/store-gift-cards/reverse", {
      transactionRef: first.body.transactionRef, reason: "Wrong amount", idempotencyKey: key,
    })).body.reversalRef).toBe(reversed.body.reversalRef);
    expect((await post(admin.token, "/store-gift-cards/reverse", {
      transactionRef: first.body.transactionRef, reason: "Different reason", idempotencyKey: randomUUID(),
    })).status).toBe(409);
    expect((await post(staff.token, "/store-gift-cards/lookup", { storeId: store1, code })).body.balanceCents).toBe(1250);
    const [credit] = await db.select().from(transactionsTable).where(eq(transactionsTable.redemptionId, card.redemptionId));
    expect(credit).toBeUndefined();
    expect((await post(admin.token, `/redemptions/${card.redemptionId}/gift-card/void`, { reason: "Test" })).status).toBe(409);
    expect((await post(admin.token, `/redemptions/${card.redemptionId}/gift-card/reissue`, {})).status).toBe(400);
  });
  it("rejects invalid, voided, and unemailed cards, full-code receipt/reason, and revoked access on retry", async () => {
    for (const status of ["voided", "email_failed", "pending_issue"] as const) {
      const { card, code } = await dummyCard(status);
      expect((await post(staff.token, "/store-gift-cards/lookup", { storeId: store1, code })).status).toBe(404);
      expect((await spend(staff.token, card.id, store1, 1)).status).toBe(403);
    }
    const { card, code } = await dummyCard();
    expect((await spend(staff.token, card.id, store1, 1, code)).status).toBe(400);
    const key = randomUUID();
    const spent = await spend(staff.token, card.id, store1, 100, uniq(), key);
    expect(spent.status).toBe(200);
    expect((await post(admin.token, "/store-gift-cards/reverse", {
      transactionRef: spent.body.transactionRef, reason: code, idempotencyKey: randomUUID(),
    })).status).toBe(400);
    expect((await request(app).delete(`/api/stores/access/${store1}/${staff.emp.id}`).set(auth(admin.token))).status).toBe(204);
    expect((await spend(staff.token, card.id, store1, 100, spent.body.receiptRef, key)).status).toBe(403);
    await post(admin.token, "/stores/access", { storeId: store1, employeeId: staff.emp.id });
    await db.update(employeesTable).set({ status: "inactive" }).where(eq(employeesTable.id, staff.emp.id));
    expect((await spend(staff.token, card.id, store1, 100, spent.body.receiptRef, key)).status).toBe(401);
    await db.update(employeesTable).set({ status: "active" }).where(eq(employeesTable.id, staff.emp.id));
  });
  it("serializes simultaneous stores, and manager cannot approve gift cards even when approvalRequired=false", async () => {
    const { card } = await dummyCard();
    const both = await Promise.all([spend(staff.token, card.id, store1, 2000), spend(staff.token, card.id, store2, 2000)]);
    expect(both.map(x => x.status).sort()).toEqual([200, 409]);
    const [credit] = await db.insert(transactionsTable).values({
      type: "award", amount: 2000, fromEmployeeId: admin.emp.id, toEmployeeId: staff.emp.id,
    }).returning();
    debitIds.push(credit.id);
    const created = await post(staff.token, "/redemptions", { rewardId, giftCardLbAmount: 100 });
    expect(created.status).toBe(201);
    redemptions.push(created.body.id);
    expect(created.body.status).toBe("requested");
    expect((await request(app).patch(`/api/redemptions/${created.body.id}/approve`).set(auth(manager.token))).status).toBe(403);
    expect((await request(app).patch(`/api/redemptions/${created.body.id}/reject`).set(auth(manager.token)).send({ adminNote: "no" })).status).toBe(403);
  });
  it("allows only one concurrent use of a store receipt even across different cards", async () => {
    const a = await dummyCard();
    const b = await dummyCard();
    const receiptRef = uniq("same-receipt");
    const responses = await Promise.all([
      spend(staff.token, a.card.id, store1, 100, receiptRef),
      spend(staff.token, b.card.id, store1, 100, receiptRef),
    ]);
    expect(responses.map(x => x.status).sort()).toEqual([200, 409]);
    const used = responses[0].status === 200 ? a : b;
    await db.update(redemptionsTable).set({ status: "approved" }).where(eq(redemptionsTable.id, used.redemption.id));
    const reject = await request(app).patch(`/api/redemptions/${used.redemption.id}/reject`)
      .set(auth(admin.token)).send({ adminNote: "Do not refund" });
    expect(reject.status).toBe(400);
    await db.update(redemptionsTable).set({ status: "fulfilled" }).where(eq(redemptionsTable.id, used.redemption.id));
  });
  it("does not allow managers or admins to spend without grants, and rejects spend after store deactivation", async () => {
    const { card } = await dummyCard();
    expect((await spend(manager.token, card.id, store1, 1)).status).toBe(403);
    expect((await spend(admin.token, card.id, store1, 1)).status).toBe(403);
    await db.update(storesTable).set({ active: false }).where(eq(storesTable.id, store1));
    expect((await spend(staff.token, card.id, store1, 1)).status).toBe(403);
    await db.update(storesTable).set({ active: true }).where(eq(storesTable.id, store1));
  });
  it("defaults real-store checkout disabled independently of sandbox DB", async () => {
    const prior = process.env.LEGEND_BUCKS_SANDBOX;
    const realFlag = process.env.STORE_GIFT_CARDS_ENABLED;
    try {
      delete process.env.LEGEND_BUCKS_SANDBOX;
      delete process.env.STORE_GIFT_CARDS_ENABLED;
      const status = await request(app).get("/api/store-gift-cards/status").set(auth(staff.token));
      expect(status.body).toEqual({ enabled: false, sandbox: false });
      expect((await spend(staff.token, 1, store1, 1)).status).toBe(403);
    } finally {
      process.env.LEGEND_BUCKS_SANDBOX = prior;
      if (realFlag === undefined) delete process.env.STORE_GIFT_CARDS_ENABLED;
      else process.env.STORE_GIFT_CARDS_ENABLED = realFlag;
    }
  });
});