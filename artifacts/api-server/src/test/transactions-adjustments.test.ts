import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { Fixtures, bearer } from "./helpers";

/**
 * Admin-only balance adjustments — used to credit starting balances when
 * employees turn in physical Legend Bucks (and to correct mistakes).
 *
 * Rules under test:
 * - Positive allow-list: only admins may adjust; managers/team members get 403.
 * - Credit raises the employee's balance; debit lowers it.
 * - Adjustments do NOT draw down the recording admin's yearly award budget,
 *   and are not limited by the global max-single-award setting.
 * - A note is required and the ledger entry records who entered it.
 */
const fx = new Fixtures();

let adminToken: string;
let adminId: number;

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin", { awardBudgetYearly: 100 });
  adminToken = admin.token;
  adminId = admin.emp.id;
});

afterAll(async () => {
  await request(app).patch("/api/settings").set(bearer(adminToken)).send({ maxSingleAward: null });
  await fx.cleanup();
});

async function getBalance(employeeId: number): Promise<number> {
  const res = await request(app).get(`/api/employees/${employeeId}/balance`).set(bearer(adminToken));
  expect(res.status).toBe(200);
  return res.body.balance;
}

describe("Balance adjustments — authorization", () => {
  it("rejects managers", async () => {
    const manager = await fx.createAuthedEmployee("manager");
    const target = await fx.createEmployee("team_member");
    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(manager.token))
      .send({ employeeId: target.id, direction: "credit", amount: 100, note: "nope" });
    expect(res.status).toBe(403);
  });

  it("rejects team members", async () => {
    const member = await fx.createAuthedEmployee("team_member");
    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(member.token))
      .send({ employeeId: member.emp.id, direction: "credit", amount: 100, note: "nope" });
    expect(res.status).toBe(403);
  });

  it("rejects accounting admins", async () => {
    const acct = await fx.createAuthedEmployee("accounting_admin");
    const target = await fx.createEmployee("team_member");
    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(acct.token))
      .send({ employeeId: target.id, direction: "credit", amount: 100, note: "nope" });
    expect(res.status).toBe(403);
  });
});

describe("Balance adjustments — validation", () => {
  it("requires a positive amount", async () => {
    const target = await fx.createEmployee("team_member");
    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, direction: "credit", amount: 0, note: "starting balance" });
    expect(res.status).toBe(400);
  });

  it("requires a non-blank note", async () => {
    const target = await fx.createEmployee("team_member");
    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, direction: "credit", amount: 100, note: "   " });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown employee", async () => {
    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(adminToken))
      .send({ employeeId: 99999999, direction: "credit", amount: 100, note: "n" });
    expect(res.status).toBe(404);
  });
});

describe("Balance adjustments — ledger effect", () => {
  it("credit raises the balance and records who entered it", async () => {
    const target = await fx.createEmployee("team_member", );
    const before = await getBalance(target.id);

    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, direction: "credit", amount: 250, note: "Starting balance – turned in physical bucks" });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("adjustment");
    expect(res.body.toEmployeeId).toBe(target.id);
    expect(res.body.fromEmployeeId).toBeNull();
    expect(res.body.note).toBe("Starting balance – turned in physical bucks");
    expect(res.body.createdById).toBe(adminId);
    expect(res.body.createdByName).toContain("Test");

    expect(await getBalance(target.id)).toBe(before + 250);
  });

  it("debit lowers the balance", async () => {
    const target = await fx.createEmployee("team_member");
    await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, direction: "credit", amount: 300, note: "start" });
    const before = await getBalance(target.id);

    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, direction: "debit", amount: 120, note: "correction" });
    expect(res.status).toBe(201);
    expect(res.body.fromEmployeeId).toBe(target.id);
    expect(res.body.toEmployeeId).toBeNull();

    expect(await getBalance(target.id)).toBe(before - 120);
  });

  it("does not touch the admin's award budget and ignores max single award", async () => {
    // Admin has a 100-buck yearly budget (set in beforeAll). Set a tiny global
    // max single award, then adjust way above both limits.
    const setRes = await request(app)
      .patch("/api/settings")
      .set(bearer(adminToken))
      .send({ maxSingleAward: 10 });
    expect(setRes.status).toBe(200);

    const target = await fx.createEmployee("team_member");
    const res = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, direction: "credit", amount: 5000, note: "big starting balance" });
    expect(res.status).toBe(201);

    // Budget usage counts only 'award' transactions — should be untouched.
    const budget = await request(app)
      .get(`/api/employees/${adminId}/award-budget`)
      .set(bearer(adminToken));
    expect(budget.status).toBe(200);
    expect(budget.body.usedThisYear).toBe(0);
    expect(budget.body.remaining).toBe(100);

    await request(app).patch("/api/settings").set(bearer(adminToken)).send({ maxSingleAward: null });
  });
});
