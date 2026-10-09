/**
 * Dedicated TRAINING_DATABASE_URL only. Never imports/runs the development
 * sandbox fixture suite. Admission fixtures are in-memory, not live employees.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, pool, employeesTable, isTraining } from "@workspace/db";
import { withTrainingTransaction, closeTrainingPool } from "@workspace/db/training-runtime";
import { verifyTrainingDatabase } from "@workspace/db/training-preflight";
import { logger } from "../lib/logger";

vi.mock("../lib/auth", async importOriginal => {
  const real = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...real,
    requireAuth: async (req: any, res: any, next: any) => {
      // Test-only gateway principals. Training requests always use real auth.
      if (!isTraining() && ["Bearer test-admission-admin", "Bearer test-admission-manager"].includes(req.headers.authorization)) {
        req.currentUser = { id: -9001, role: req.headers.authorization.endsWith("admin") ? "admin" : "manager", status: "active" };
        next(); return;
      }
      return real.requireAuth(req, res, next);
    },
  };
});
import app from "../app";

const controls = "/api/training";
const base = `${controls}/api`;
const tokens: Record<string, string> = {};
let rewardId: number;
let employeeId: number;
let storeId: number;
let cardId: number;
let lookupToken: string;
const originalFlag = process.env.TRAINING_MODE_ENABLED;
const allowReset = process.env.TRAINING_TEST_ALLOW_RESET === "true";
let normalQuery: ReturnType<typeof vi.spyOn>;
let normalConnect: ReturnType<typeof vi.spyOn>;
let connector: ReturnType<typeof vi.spyOn>;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const controlAuth = auth("test-admission-admin");

async function launch() {
  for (const persona of ["admin", "manager", "employee", "accounting", "operator"]) {
    const response = await request(app).post(`${controls}/session`).set(controlAuth).send({ persona });
    expect(response.status).toBe(200);
    tokens[persona] = response.body.sessionToken;
  }
}
async function lookup(id: number, persona = "operator") {
  return request(app).post(`${base}/store-gift-cards/lookup`).set(auth(tokens[persona]))
    .send({ storeId, code: `TRAINING-CARD-${id}` });
}
async function issueCard() {
  const requested = await request(app).post(`${base}/redemptions`).set(auth(tokens.employee)).send({
    rewardId, giftCardLbAmount: 100, giftCardRecipientName: "Training Recipient",
    giftCardRecipientEmail: "training.recipient@example.test",
  });
  expect(requested.status).toBe(201);
  const id = requested.body.id;
  expect((await request(app).patch(`${base}/redemptions/${id}/approve`).set(auth(tokens.admin))).status).toBe(200);
  expect((await request(app).post(`${base}/redemptions/${id}/gift-card/issue`).set(auth(tokens.admin))).status).toBe(200);
  const cards = await request(app).get(`${base}/training/cards`).set(auth(tokens.operator));
  expect(cards.status).toBe(200);
  return cards.body.cards[0].id as number;
}

beforeAll(async () => {
  if (!allowReset) return;
  logger.level = "silent";
  const checked = await verifyTrainingDatabase();
  if (!checked.connected || !checked.restricted || !checked.initialized) {
    throw new Error("Refusing tests: dedicated, initialized, restricted training database required");
  }
  // Tests fail immediately if any workflow attempts to touch the normal DB.
  normalQuery = vi.spyOn(pool, "query").mockImplementation(() => { throw new Error("Forbidden normal DB query"); });
  normalConnect = vi.spyOn(pool, "connect").mockImplementation(() => { throw new Error("Forbidden normal DB connection"); });
  connector = vi.spyOn(ReplitConnectors.prototype, "proxy").mockImplementation(async () => { throw new Error("Forbidden outbound integration"); });
  process.env.TRAINING_MODE_ENABLED = "true"; // this test process only
  const reset = await request(app).post(`${controls}/reset`).set(controlAuth).send({ confirmation: "RESET TRAINING DATA" });
  expect(reset.status).toBe(200);
  await launch();
  const rewards = await request(app).get(`${base}/rewards`).set(auth(tokens.employee));
  rewardId = rewards.body.find((item: any) => item.isCustomGiftCard).id;
  const me = await request(app).get(`${base}/auth/me`).set(auth(tokens.employee));
  employeeId = me.body.id;
  const stores = await request(app).get(`${base}/store-gift-cards/my-stores`).set(auth(tokens.operator));
  storeId = stores.body[0].id;
}, 120000);

afterAll(async () => {
  if (!allowReset) return;
  try {
    if (tokens.admin) {
      await request(app).post(`${controls}/reset`).set(controlAuth).send({ confirmation: "RESET TRAINING DATA" });
    }
    expect(normalQuery).not.toHaveBeenCalled();
    expect(normalConnect).not.toHaveBeenCalled();
    expect(connector).not.toHaveBeenCalled();
  } finally {
    if (originalFlag === undefined) delete process.env.TRAINING_MODE_ENABLED;
    else process.env.TRAINING_MODE_ENABLED = originalFlag;
    vi.restoreAllMocks();
    await closeTrainingPool();
  }
}, 120000);

describe.skipIf(!allowReset).sequential("training isolation and real workflows", () => {
  it("rejects normal tokens in training and training tokens on normal endpoints", async () => {
    expect((await request(app).get(`${base}/auth/me`).set(controlAuth)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set(auth(tokens.employee))).status).toBe(401);
    expect((await request(app).post("/api/transactions").set(auth(tokens.admin)).send({ toEmployeeId: 1, amount: 100 })).status).toBe(401);
    expect((await request(app).post(`${controls}/session`).set(auth("test-admission-manager")).send({ persona: "admin" })).status).toBe(403);
    expect((await request(app).post(`${controls}/reset`).set(auth(tokens.admin)).send({ confirmation: "RESET TRAINING DATA" })).status).toBe(401);
  });
  it("fails closed when disabled, with unknown routes, storage, real recipients and missing configuration", async () => {
    process.env.TRAINING_MODE_ENABLED = "false";
    expect((await request(app).get(`${base}/auth/me`).set(auth(tokens.admin))).status).toBe(503);
    process.env.TRAINING_MODE_ENABLED = "true";
    expect((await request(app).get(`${base}/unknown`).set(auth(tokens.admin))).status).toBe(403);
    expect((await request(app).post(`${base}/storage/uploads/request-url`).set(auth(tokens.admin)).send({ name: "x" })).status).toBe(403);
    expect((await request(app).post(`${base}/auth/login`).set(auth(tokens.admin)).send({ email: "someone@example.test" })).status).toBe(403);
    expect((await request(app).post(`${base}/auth/invite`).set(auth(tokens.admin)).send({ email: "real@example.com" })).status).toBe(400);
    const saved = process.env.TRAINING_DATABASE_URL;
    try {
      delete process.env.TRAINING_DATABASE_URL;
      expect((await request(app).get(`${base}/auth/me`).set(auth(tokens.admin))).status).toBe(503);
    } finally { process.env.TRAINING_DATABASE_URL = saved; }
  });
  it("preserves manager award permissions and blocks accounting writes", async () => {
    const award = await request(app).post(`${base}/transactions`).set(auth(tokens.manager))
      .send({ toEmployeeId: employeeId, amount: 10, note: "TRAINING — Practice award" });
    expect(award.status).toBe(201);
    expect((await request(app).post(`${base}/transactions`).set(auth(tokens.accounting)).send({ toEmployeeId: employeeId, amount: 1 })).status).toBe(403);
    expect((await request(app).get(`${base}/transactions`).set(auth(tokens.accounting))).status).toBe(200);
  });
  it("requires admin approval and separate Issue & Email; records only simulated delivery", async () => {
    const response = await request(app).post(`${base}/redemptions`).set(auth(tokens.employee)).send({
      rewardId, giftCardLbAmount: 100, giftCardRecipientName: "Training Recipient", giftCardRecipientEmail: "training.recipient@example.test",
    });
    expect(response.status).toBe(201);
    const id = response.body.id;
    expect((await request(app).post(`${base}/redemptions/${id}/gift-card/issue`).set(auth(tokens.admin))).status).toBe(400);
    expect((await request(app).patch(`${base}/redemptions/${id}/approve`).set(auth(tokens.manager))).status).toBe(403);
    expect((await request(app).post(`${base}/redemptions/${id}/gift-card/issue`).set(auth(tokens.manager))).status).toBe(403);
    expect((await request(app).patch(`${base}/redemptions/${id}/approve`).set(auth(tokens.admin))).status).toBe(200);
    const before = await request(app).get(`${base}/training/cards`).set(auth(tokens.operator));
    expect(before.body.cards).toHaveLength(0);
    expect((await request(app).post(`${base}/redemptions/${id}/gift-card/issue`).set(auth(tokens.admin))).status).toBe(200);
    const cards = await request(app).get(`${base}/training/cards`).set(auth(tokens.operator));
    cardId = cards.body.cards[0].id;
    const outbox = await request(app).get(`${base}/training/outbox`).set(auth(tokens.accounting));
    expect(outbox.status).toBe(200);
    expect(outbox.body.messages.some((m: any) => m.giftCardIssueId === cardId)).toBe(true);
    expect(JSON.stringify(outbox.body)).not.toMatch(/LBGC-|https?:\/\//);
    expect((await request(app).get(`${base}/training/outbox`).set(auth(tokens.employee))).status).toBe(403);
  });
  it("requires explicit store grants even for admin and rejects real card codes", async () => {
    expect((await lookup(cardId, "admin")).status).toBe(403);
    expect((await lookup(cardId, "employee")).status).toBe(403);
    expect((await request(app).post(`${base}/store-gift-cards/lookup`).set(auth(tokens.operator)).send({ storeId, code: "LBGC-REJECTED" })).status).toBe(400);
    const result = await lookup(cardId);
    expect(result.status).toBe(200);
    expect(result.body.balanceCents).toBe(1000);
    lookupToken = result.body.lookupToken;
  });
  it("spends CAD 1 from CAD 10, rejects duplicate receipts, and reconciles CAD 9", async () => {
    const receiptRef = `TRAINING-${randomUUID()}`;
    const body = { storeId, cardId, lookupToken, amountCents: 100, receiptRef, idempotencyKey: randomUUID() };
    const spent = await request(app).post(`${base}/store-gift-cards/spend`).set(auth(tokens.operator)).send(body);
    expect(spent.status).toBe(200);
    expect(spent.body.previousBalanceCents).toBe(1000);
    expect(spent.body.newBalanceCents).toBe(900);
    const retry = await request(app).post(`${base}/store-gift-cards/spend`).set(auth(tokens.operator)).send(body);
    // Existing till semantics: same idempotency key returns the original
    // result, while a second attempt with a new key + same receipt is rejected.
    expect(retry.status).toBe(200);
    expect(retry.body.transactionRef).toBe(spent.body.transactionRef);
    const duplicate = await request(app).post(`${base}/store-gift-cards/spend`).set(auth(tokens.operator)).send({ ...body, idempotencyKey: randomUUID() });
    expect(duplicate.status).toBe(409);
    expect((await lookup(cardId)).body.balanceCents).toBe(900);
    const audit = await request(app).get(`${base}/store-gift-cards/transactions`).set(auth(tokens.admin));
    expect(audit.status).toBe(200);
    expect(audit.body.filter((row: any) => row.receiptRef === receiptRef)).toHaveLength(1);
    expect(audit.body.find((row: any) => row.receiptRef === receiptRef).newBalanceCents).toBe(900);
  });
  it("serializes concurrent spends so two CAD 7 requests cannot overdraw CAD 10", async () => {
    const id = await issueCard();
    const found = await lookup(id);
    const spends = await Promise.all([1, 2].map(() => request(app).post(`${base}/store-gift-cards/spend`)
      .set(auth(tokens.operator)).send({
        storeId, cardId: id, lookupToken: found.body.lookupToken, amountCents: 700,
        receiptRef: `TRAINING-${randomUUID()}`, idempotencyKey: randomUUID(),
      })));
    expect(spends.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await lookup(id)).body.balanceCents).toBe(300);
  });
  it("reset revokes old sessions without reusing employee IDs or touching normal data", async () => {
    const old = tokens.employee;
    expect((await request(app).post(`${controls}/reset`).set(controlAuth).send({ confirmation: "RESET TRAINING DATA" })).status).toBe(200);
    expect((await request(app).get(`${base}/auth/me`).set(auth(old))).status).toBe(401);
    await launch();
    const fresh = await request(app).get(`${base}/auth/me`).set(auth(tokens.employee));
    expect(fresh.status).toBe(200);
    expect(fresh.body.balance).toBe(1000);
    expect(fresh.body.id).not.toBe(employeeId);
    const count = await withTrainingTransaction(async () => (await db.select().from(employeesTable)).length);
    expect(count).toBe(5);
    expect(normalQuery).not.toHaveBeenCalled();
    expect(normalConnect).not.toHaveBeenCalled();
    expect(connector).not.toHaveBeenCalled();
  });
});
