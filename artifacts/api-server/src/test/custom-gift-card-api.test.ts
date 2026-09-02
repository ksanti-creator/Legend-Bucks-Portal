import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  giftCardIssuesTable,
  redemptionsTable,
  rewardsTable,
  transactionsTable,
} from "@workspace/db";
import { Fixtures, bearer, uniq } from "./helpers";

vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendGiftCardRecipientEmail: vi.fn().mockResolvedValue(undefined),
    sendRedemptionReceiptEmail: vi.fn().mockResolvedValue(undefined),
    sendNewRedemptionRequestEmail: vi.fn().mockResolvedValue(undefined),
    sendRedemptionApprovedEmail: vi.fn().mockResolvedValue(undefined),
    sendRedemptionRejectedEmail: vi.fn().mockResolvedValue(undefined),
  };
});

import app from "../app";
import { sendGiftCardRecipientEmail } from "../lib/email";

const fx = new Fixtures();
const rewardIds: number[] = [];
const redemptionIds: number[] = [];
const transactionIds: number[] = [];
let adminToken: string;
let employeeToken: string;
let employeeId: number;
let customRewardId: number;

describe("custom gift card API", () => {
  beforeAll(async () => {
    const admin = await fx.createAuthedEmployee("admin");
    const employee = await fx.createAuthedEmployee("team_member");
    adminToken = admin.token;
    employeeToken = employee.token;
    employeeId = employee.emp.id;
    const [credit] = await db.insert(transactionsTable).values({
      type: "award", amount: 5_000, fromEmployeeId: admin.emp.id, toEmployeeId: employeeId, note: uniq("credit"),
    }).returning();
    transactionIds.push(credit.id);

    const custom = await request(app).post("/api/rewards").set(bearer(adminToken)).send({
      name: uniq("Legend Bucks Gift Card"),
      category: "Gift Card",
      buckCost: 100,
      isCustomGiftCard: true,
      giftCardIncrementLb: 100,
      giftCardMinimumLb: 100,
      giftCardMaximumLb: null,
    });
    expect(custom.status).toBe(201);
    expect(custom.body.approvalRequired).toBe(true);
    expect(custom.body.quantity).toBeNull();
    customRewardId = custom.body.id;
    rewardIds.push(customRewardId);
  });

  afterAll(async () => {
    if (redemptionIds.length) {
      await db.delete(giftCardIssuesTable).where(inArray(giftCardIssuesTable.redemptionId, redemptionIds));
      const debits = await db.select({ id: transactionsTable.id }).from(transactionsTable)
        .where(inArray(transactionsTable.redemptionId, redemptionIds));
      if (debits.length) transactionIds.push(...debits.map((row) => row.id));
      await db.delete(transactionsTable).where(inArray(transactionsTable.redemptionId, redemptionIds));
      await db.delete(redemptionsTable).where(inArray(redemptionsTable.id, redemptionIds));
    }
    if (transactionIds.length) await db.delete(transactionsTable).where(inArray(transactionsTable.id, transactionIds));
    if (rewardIds.length) await db.delete(rewardsTable).where(inArray(rewardsTable.id, rewardIds));
    await fx.cleanup();
  });

  const redeem = (amount: number, rewardId = customRewardId) =>
    request(app).post("/api/redemptions").set(bearer(employeeToken)).send({
      rewardId,
      giftCardLbAmount: amount,
      giftCardRecipientName: "Gift Recipient",
      giftCardRecipientEmail: `${uniq("recipient")}@example.test`,
      giftCardMessage: "Enjoy your gift!",
    });

  it("rejects invalid increments, negatives, and amounts over the available balance", async () => {
    expect((await redeem(99)).status).toBe(400);
    expect((await redeem(125)).status).toBe(400);
    expect((await redeem(-100)).status).toBe(400);
    expect((await redeem(5_100)).status).toBe(400);
  });

  it("rejects custom denomination fields for an ordinary reward", async () => {
    const [ordinary] = await db.insert(rewardsTable).values({ name: uniq("ordinary"), buckCost: 100 }).returning();
    rewardIds.push(ordinary.id);
    expect((await redeem(100, ordinary.id)).status).toBe(400);
  });

  it("enforces the fixed 100 LB increment when configuring a custom gift card", async () => {
    const response = await request(app).post("/api/rewards").set(bearer(adminToken)).send({
      name: uniq("invalid increment gift card"),
      category: "Gift Card",
      buckCost: 100,
      isCustomGiftCard: true,
      giftCardIncrementLb: 25,
      giftCardMinimumLb: 100,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/fixed 100 LB increment/i);
  });

  it("snapshots/debits the selected value and refunds that exact value on rejection", async () => {
    const response = await redeem(700);
    expect(response.status).toBe(201);
    redemptionIds.push(response.body.id);
    expect(response.body.buckCost).toBe(700);
    expect(response.body.giftCardLbAmount).toBe(700);
    const [snapshot] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, response.body.id));
    expect(snapshot.giftCardCadValueCents).toBe(7_000);

    expect((await request(app).patch(`/api/redemptions/${response.body.id}/reject`).set(bearer(adminToken)).send({})).status).toBe(200);
    const [refund] = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.redemptionId, response.body.id),
      eq(transactionsTable.type, "refund"),
    ));
    expect(refund.amount).toBe(700);
  });

  it("issues only a hash/last-four, fulfills after email, and securely reissues", async () => {
    const response = await redeem(500);
    redemptionIds.push(response.body.id);
    await request(app).patch(`/api/redemptions/${response.body.id}/approve`).set(bearer(adminToken));
    const issued = await request(app).post(`/api/redemptions/${response.body.id}/gift-card/issue`).set(bearer(adminToken));
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe("emailed");
    const firstCode = vi.mocked(sendGiftCardRecipientEmail).mock.calls.at(-1)![2];
    expect(JSON.stringify(issued.body)).not.toContain(firstCode);
    const [stored] = await db.select().from(giftCardIssuesTable).where(eq(giftCardIssuesTable.redemptionId, response.body.id));
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(firstCode);
    expect((await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, response.body.id)))[0].status).toBe("fulfilled");

    const reissued = await request(app).post(`/api/redemptions/${response.body.id}/gift-card/reissue`).set(bearer(adminToken));
    expect(reissued.body.status).toBe("emailed");
    const replacementCode = vi.mocked(sendGiftCardRecipientEmail).mock.calls.at(-1)![2];
    expect(replacementCode).not.toBe(firstCode);
    const rows = await db.select().from(giftCardIssuesTable).where(eq(giftCardIssuesTable.redemptionId, response.body.id));
    expect(rows.some((row) => row.status === "reissued" && row.voidedAt !== null)).toBe(true);
  });

  it("leaves delivery failed and does not claim fulfillment when Gmail fails", async () => {
    vi.mocked(sendGiftCardRecipientEmail).mockRejectedValueOnce(new Error("simulated Gmail failure"));
    const response = await redeem(300);
    redemptionIds.push(response.body.id);
    await request(app).patch(`/api/redemptions/${response.body.id}/approve`).set(bearer(adminToken));
    const issued = await request(app).post(`/api/redemptions/${response.body.id}/gift-card/issue`).set(bearer(adminToken));
    expect(issued.body.status).toBe("email_failed");
    expect((await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, response.body.id)))[0].status).toBe("approved");

    const unsafeRefund = await request(app)
      .patch(`/api/redemptions/${response.body.id}/reject`)
      .set(bearer(adminToken))
      .send({});
    expect(unsafeRefund.status).toBe(400);
    expect(unsafeRefund.body.error).toMatch(/void the issued gift card/i);

    await request(app)
      .post(`/api/redemptions/${response.body.id}/gift-card/void`)
      .set(bearer(adminToken))
      .send({ reason: "Email outcome is uncertain; cancelling issuance" })
      .expect(200);
    await request(app)
      .patch(`/api/redemptions/${response.body.id}/reject`)
      .set(bearer(adminToken))
      .send({})
      .expect(200);
  });
});