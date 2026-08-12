import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, transactionsTable } from "@workspace/db";
import { Fixtures, bearer } from "./helpers";
import { STARTING_BALANCE_NOTE } from "../lib/startingBalance";

/**
 * One-step starting-balance correction — for when an admin mistypes the
 * starting balance on the invite form.
 *
 * Rules under test:
 * - Admin-only (positive allow-list); managers/team members/accounting get 403.
 * - The server computes the offsetting entry itself: raising the starting
 *   balance credits the delta, lowering it debits the delta.
 * - GET /employees/:id/starting-balance reports original, effective (after
 *   corrections), and how many corrections have been applied.
 * - Employees with no invite-time starting balance can't use the shortcut.
 * - Correcting to the already-recorded amount is rejected (nothing to do).
 */
const fx = new Fixtures();

let adminToken: string;

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;
});

afterAll(async () => {
  await fx.cleanup();
});

/** Insert the same ledger row the invite flow writes for a starting balance. */
async function seedStartingBalance(employeeId: number, amount: number) {
  await db.insert(transactionsTable).values({
    type: "adjustment",
    amount,
    toEmployeeId: employeeId,
    fromEmployeeId: null,
    note: STARTING_BALANCE_NOTE,
  });
}

async function getBalance(employeeId: number): Promise<number> {
  const res = await request(app).get(`/api/employees/${employeeId}/balance`).set(bearer(adminToken));
  expect(res.status).toBe(200);
  return res.body.balance;
}

async function getStartingInfo(employeeId: number) {
  const res = await request(app)
    .get(`/api/employees/${employeeId}/starting-balance`)
    .set(bearer(adminToken));
  expect(res.status).toBe(200);
  return res.body;
}

describe("Starting-balance correction — authorization", () => {
  it("rejects non-admins on both endpoints", async () => {
    const manager = await fx.createAuthedEmployee("manager");
    const member = await fx.createAuthedEmployee("team_member");
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 500);

    for (const token of [manager.token, member.token]) {
      const post = await request(app)
        .post("/api/transactions/starting-balance-corrections")
        .set(bearer(token))
        .send({ employeeId: target.id, correctedAmount: 300 });
      expect(post.status).toBe(403);

      const get = await request(app)
        .get(`/api/employees/${target.id}/starting-balance`)
        .set(bearer(token));
      expect(get.status).toBe(403);
    }
  });
});

describe("Starting-balance info", () => {
  it("reports no starting balance when none was recorded", async () => {
    const target = await fx.createEmployee("team_member");
    const info = await getStartingInfo(target.id);
    expect(info.hasStartingBalance).toBe(false);
    expect(info.originalAmount).toBeNull();
    expect(info.effectiveAmount).toBeNull();
  });

  it("reports the invite-time amount", async () => {
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 500);
    const info = await getStartingInfo(target.id);
    expect(info).toMatchObject({
      hasStartingBalance: true,
      originalAmount: 500,
      effectiveAmount: 500,
      correctionCount: 0,
    });
  });
});

describe("Starting-balance correction — behavior", () => {
  it("debits the delta when the balance was typed too high", async () => {
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 500); // meant to be 50

    const res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, correctedAmount: 50 });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("adjustment");
    expect(res.body.amount).toBe(450);
    expect(res.body.fromEmployeeId).toBe(target.id);
    expect(res.body.toEmployeeId).toBeNull();
    expect(res.body.note).toContain("Starting balance correction");

    expect(await getBalance(target.id)).toBe(50);
    const info = await getStartingInfo(target.id);
    expect(info).toMatchObject({ originalAmount: 500, effectiveAmount: 50, correctionCount: 1 });
  });

  it("credits the delta when the balance was typed too low", async () => {
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 50); // meant to be 500

    const res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, correctedAmount: 500 });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(450);
    expect(res.body.toEmployeeId).toBe(target.id);
    expect(res.body.fromEmployeeId).toBeNull();

    expect(await getBalance(target.id)).toBe(500);
  });

  it("nets out prior corrections instead of re-offsetting the original", async () => {
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 500);

    // First correction: 500 → 200
    let res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, correctedAmount: 200 });
    expect(res.status).toBe(201);

    // Second correction: 200 → 250 must credit only 50.
    res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, correctedAmount: 250 });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(50);
    expect(res.body.toEmployeeId).toBe(target.id);

    expect(await getBalance(target.id)).toBe(250);
    const info = await getStartingInfo(target.id);
    expect(info).toMatchObject({ originalAmount: 500, effectiveAmount: 250, correctionCount: 2 });
  });

  it("leaves other ledger activity untouched", async () => {
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 500);

    // A regular admin adjustment on top of the starting balance.
    const adj = await request(app)
      .post("/api/transactions/adjustments")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, direction: "credit", amount: 100, note: "spot bonus" });
    expect(adj.status).toBe(201);

    const res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, correctedAmount: 300 });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(200); // only the starting-balance delta

    // 300 corrected starting balance + 100 bonus
    expect(await getBalance(target.id)).toBe(400);
  });
});

describe("Starting-balance correction — validation", () => {
  it("rejects when no starting balance is recorded", async () => {
    const target = await fx.createEmployee("team_member");
    const res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, correctedAmount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no starting balance/i);
  });

  it("rejects a no-op correction", async () => {
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 500);
    const res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, correctedAmount: 500 });
    expect(res.status).toBe(400);
  });

  it("rejects negative and fractional amounts", async () => {
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 500);
    for (const correctedAmount of [-10, 12.5]) {
      const res = await request(app)
        .post("/api/transactions/starting-balance-corrections")
        .set(bearer(adminToken))
        .send({ employeeId: target.id, correctedAmount });
      expect(res.status).toBe(400);
    }
  });

  it("allows correcting down to zero", async () => {
    const target = await fx.createEmployee("team_member");
    await seedStartingBalance(target.id, 500); // shouldn't have had one at all
    const res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: target.id, correctedAmount: 0 });
    expect(res.status).toBe(201);
    expect(await getBalance(target.id)).toBe(0);
  });

  it("404s for a nonexistent employee", async () => {
    const res = await request(app)
      .post("/api/transactions/starting-balance-corrections")
      .set(bearer(adminToken))
      .send({ employeeId: 99999999, correctedAmount: 100 });
    expect(res.status).toBe(404);
  });
});
