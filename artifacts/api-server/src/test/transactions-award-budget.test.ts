import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db, transactionsTable } from "@workspace/db";
import app from "../app";
import { Fixtures, bearer } from "./helpers";

/**
 * Per-user yearly award budget + the global maximum single award.
 *
 * Every award draws down the *sender's* own yearly budget (reset per UTC
 * calendar year). A sender with no budget set cannot award at all. A separate
 * global "maximum single award" caps any one award regardless of who sends it.
 */
const fx = new Fixtures();

let adminToken: string;

async function setBudget(employeeId: number, budget: number | null) {
  const res = await request(app)
    .patch(`/api/employees/${employeeId}`)
    .set(bearer(adminToken))
    .send({ awardBudgetYearly: budget });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;
});

afterAll(async () => {
  // Ensure the global single-award limit is cleared so other suites are unaffected.
  await request(app).patch("/api/settings").set(bearer(adminToken)).send({ maxSingleAward: null });
  await fx.cleanup();
});

describe("Per-user yearly award budget — enforcement", () => {
  it("lets a sender award within their budget", async () => {
    const sender = await fx.createAuthedEmployee("manager", { awardBudgetYearly: 100 });
    const recipient = await fx.createEmployee("team_member");

    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(sender.token))
      .send({ toEmployeeId: recipient.id, amount: 60 });
    expect(res.status).toBe(201);
  });

  it("blocks an award once the year's total would exceed the sender's budget", async () => {
    const sender = await fx.createAuthedEmployee("manager", { awardBudgetYearly: 100 });
    const recipient = await fx.createEmployee("team_member");

    const first = await request(app)
      .post("/api/transactions")
      .set(bearer(sender.token))
      .send({ toEmployeeId: recipient.id, amount: 60 });
    expect(first.status).toBe(201);

    // 60 + 60 = 120 > 100 → blocked.
    const second = await request(app)
      .post("/api/transactions")
      .set(bearer(sender.token))
      .send({ toEmployeeId: recipient.id, amount: 60 });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/budget/i);

    // 60 + 40 = 100 → exactly at the budget, allowed.
    const third = await request(app)
      .post("/api/transactions")
      .set(bearer(sender.token))
      .send({ toEmployeeId: recipient.id, amount: 40 });
    expect(third.status).toBe(201);
  });

  it("blocks a sender with no budget set from awarding at all", async () => {
    const sender = await fx.createAuthedEmployee("manager", { awardBudgetYearly: null });
    const recipient = await fx.createEmployee("team_member");

    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(sender.token))
      .send({ toEmployeeId: recipient.id, amount: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budget/i);
  });

  it("only counts current-year awards toward the budget", async () => {
    const sender = await fx.createAuthedEmployee("manager", { awardBudgetYearly: 100 });
    const recipient = await fx.createEmployee("team_member");

    // Seed a large award from this sender dated last year — must NOT reduce this
    // year's remaining budget.
    const lastYear = new Date().getUTCFullYear() - 1;
    await db.insert(transactionsTable).values({
      type: "award",
      amount: 90,
      fromEmployeeId: sender.emp.id,
      toEmployeeId: recipient.id,
      createdAt: new Date(Date.UTC(lastYear, 5, 1)),
    });

    const info = await request(app)
      .get(`/api/employees/${sender.emp.id}/award-budget`)
      .set(bearer(adminToken));
    expect(info.status).toBe(200);
    expect(info.body.usedThisYear).toBe(0);
    expect(info.body.remaining).toBe(100);

    // The full budget is still available this year despite last year's award.
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(sender.token))
      .send({ toEmployeeId: recipient.id, amount: 100 });
    expect(res.status).toBe(201);
  });
});

describe("Global maximum single award", () => {
  let capManager: { emp: { id: number }; token: string };
  let recipientId: number;

  beforeAll(async () => {
    capManager = await fx.createAuthedEmployee("manager", { awardBudgetYearly: 1_000_000 });
    const r = await fx.createEmployee("team_member");
    recipientId = r.id;
    const res = await request(app).patch("/api/settings").set(bearer(adminToken)).send({ maxSingleAward: 50 });
    expect(res.status).toBe(200);
    expect(res.body.maxSingleAward).toBe(50);
  });

  afterAll(async () => {
    const res = await request(app).patch("/api/settings").set(bearer(adminToken)).send({ maxSingleAward: null });
    expect(res.status).toBe(200);
    expect(res.body.maxSingleAward).toBeNull();
  });

  it("is readable by any authenticated user", async () => {
    const tm = await fx.createAuthedEmployee("team_member");
    const res = await request(app).get("/api/settings").set(bearer(tm.token));
    expect(res.status).toBe(200);
    expect(res.body.maxSingleAward).toBe(50);
  });

  it("blocks a single award above the limit (manager)", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(capManager.token))
      .send({ toEmployeeId: recipientId, amount: 60 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum single award/i);
  });

  it("blocks a single award above the limit for admins too", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: recipientId, amount: 60 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum single award/i);
  });

  it("allows an award at exactly the limit", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(capManager.token))
      .send({ toEmployeeId: recipientId, amount: 50 });
    expect(res.status).toBe(201);
  });

  it("rejects a non-admin trying to change the setting", async () => {
    const tm = await fx.createAuthedEmployee("team_member");
    const res = await request(app).patch("/api/settings").set(bearer(tm.token)).send({ maxSingleAward: 5 });
    expect(res.status).toBe(403);
  });
});

describe("Award-budget visibility", () => {
  it("lets an admin read anyone's budget + usage", async () => {
    const sender = await fx.createAuthedEmployee("manager", { awardBudgetYearly: 100 });
    const res = await request(app)
      .get(`/api/employees/${sender.emp.id}/award-budget`)
      .set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.budget).toBe(100);
    expect(res.body.remaining).toBe(100);
    expect(res.body.usedThisYear).toBe(0);
  });

  it("lets a user read their own budget", async () => {
    const sender = await fx.createAuthedEmployee("manager", { awardBudgetYearly: 250 });
    const res = await request(app)
      .get(`/api/employees/${sender.emp.id}/award-budget`)
      .set(bearer(sender.token));
    expect(res.status).toBe(200);
    expect(res.body.budget).toBe(250);
  });

  it("reports null budget/remaining for a user with no budget set", async () => {
    const sender = await fx.createAuthedEmployee("manager", { awardBudgetYearly: null });
    const res = await request(app)
      .get(`/api/employees/${sender.emp.id}/award-budget`)
      .set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.budget).toBeNull();
    expect(res.body.remaining).toBeNull();
  });

  it("forbids reading another user's budget", async () => {
    const sender = await fx.createAuthedEmployee("manager", { awardBudgetYearly: 100 });
    const other = await fx.createAuthedEmployee("manager");
    const res = await request(app)
      .get(`/api/employees/${sender.emp.id}/award-budget`)
      .set(bearer(other.token));
    expect(res.status).toBe(403);
  });

  it("does not leak awardBudgetYearly in the employee listing", async () => {
    const res = await request(app).get("/api/employees").set(bearer(adminToken));
    expect(res.status).toBe(200);
    for (const e of res.body as Array<{ awardBudgetYearly: number | null }>) {
      expect(e.awardBudgetYearly).toBeNull();
    }
  });
});
