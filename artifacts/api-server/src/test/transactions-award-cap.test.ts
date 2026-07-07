import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db, transactionsTable } from "@workspace/db";
import app from "../app";
import { Fixtures, bearer } from "./helpers";

/**
 * Per-employee yearly award cap.
 *
 * A recipient may carry an optional cap limiting how many bucks their manager
 * may award them per calendar year. Admins are never limited. The cap + this-
 * year remaining are private to the employee's assigned manager and admins.
 */
const fx = new Fixtures();

let adminToken: string;
let managerId: number;
let managerToken: string;
let otherManagerId: number;
let otherManagerToken: string;

async function setCap(employeeId: number, cap: number | null, managerId?: number) {
  const body: Record<string, unknown> = { awardCapYearly: cap };
  if (managerId !== undefined) body.managerId = managerId;
  const res = await request(app).patch(`/api/employees/${employeeId}`).set(bearer(adminToken)).send(body);
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;

  const manager = await fx.createAuthedEmployee("manager");
  managerId = manager.emp.id;
  managerToken = manager.token;

  const other = await fx.createAuthedEmployee("manager");
  otherManagerId = other.emp.id;
  otherManagerToken = other.token;
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Per-employee yearly award cap — enforcement", () => {
  it("blocks a manager awarding more than the recipient's cap in one go", async () => {
    const r = await fx.createEmployee("team_member");
    await setCap(r.id, 100, managerId);

    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(managerToken))
      .send({ toEmployeeId: r.id, amount: 150 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cap/i);
  });

  it("allows awards under the cap but blocks once the yearly total would exceed it", async () => {
    const r = await fx.createEmployee("team_member");
    await setCap(r.id, 100, managerId);

    const first = await request(app)
      .post("/api/transactions")
      .set(bearer(managerToken))
      .send({ toEmployeeId: r.id, amount: 60 });
    expect(first.status).toBe(201);

    // 60 + 60 = 120 > 100 → blocked
    const second = await request(app)
      .post("/api/transactions")
      .set(bearer(managerToken))
      .send({ toEmployeeId: r.id, amount: 60 });
    expect(second.status).toBe(400);

    // 60 + 40 = 100 → exactly at the cap, allowed
    const third = await request(app)
      .post("/api/transactions")
      .set(bearer(managerToken))
      .send({ toEmployeeId: r.id, amount: 40 });
    expect(third.status).toBe(201);
  });

  it("does not limit awards to a recipient with no cap", async () => {
    const r = await fx.createEmployee("team_member");
    await setCap(r.id, null, managerId);

    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(managerToken))
      .send({ toEmployeeId: r.id, amount: 1_000_000 });
    expect(res.status).toBe(201);
  });

  it("never limits an admin, even when the recipient has a cap", async () => {
    const r = await fx.createEmployee("team_member");
    await setCap(r.id, 10, managerId);

    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: r.id, amount: 5000 });
    expect(res.status).toBe(201);
  });

  it("does not apply the cap to a manager who is not the recipient's assigned manager", async () => {
    const r = await fx.createEmployee("team_member");
    // Assigned manager is `managerId`; the cap only governs them.
    await setCap(r.id, 10, managerId);

    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(otherManagerToken))
      .send({ toEmployeeId: r.id, amount: 5000 });
    expect(res.status).toBe(201);
  });

  it("only counts awards from the current calendar year toward the cap", async () => {
    const r = await fx.createEmployee("team_member");
    await setCap(r.id, 100, managerId);

    // Seed a large award from the assigned manager dated last year — it must
    // NOT reduce this year's remaining.
    const lastYear = new Date().getUTCFullYear() - 1;
    await db.insert(transactionsTable).values({
      type: "award",
      amount: 90,
      fromEmployeeId: managerId,
      toEmployeeId: r.id,
      createdAt: new Date(Date.UTC(lastYear, 5, 1)),
    });

    const info = await request(app).get(`/api/employees/${r.id}/award-cap`).set(bearer(managerToken));
    expect(info.status).toBe(200);
    expect(info.body.usedThisYear).toBe(0);
    expect(info.body.remaining).toBe(100);

    // The full cap is still available this year despite last year's award.
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(managerToken))
      .send({ toEmployeeId: r.id, amount: 100 });
    expect(res.status).toBe(201);
  });
});

describe("Per-employee yearly award cap — privacy", () => {
  it("lets the assigned manager read the cap + remaining", async () => {
    const r = await fx.createEmployee("team_member");
    await setCap(r.id, 100, managerId);

    const res = await request(app).get(`/api/employees/${r.id}/award-cap`).set(bearer(managerToken));
    expect(res.status).toBe(200);
    expect(res.body.cap).toBe(100);
    expect(res.body.remaining).toBe(100);
    expect(res.body.usedThisYear).toBe(0);
  });

  it("lets an admin read the cap", async () => {
    const r = await fx.createEmployee("team_member");
    await setCap(r.id, 100, managerId);

    const res = await request(app).get(`/api/employees/${r.id}/award-cap`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.cap).toBe(100);
  });

  it("forbids the employee from reading their own cap", async () => {
    const authed = await fx.createAuthedEmployee("team_member");
    await setCap(authed.emp.id, 100, managerId);

    const res = await request(app).get(`/api/employees/${authed.emp.id}/award-cap`).set(bearer(authed.token));
    expect(res.status).toBe(403);
  });

  it("forbids an unrelated manager from reading the cap", async () => {
    const r = await fx.createEmployee("team_member");
    await setCap(r.id, 100, managerId);

    const res = await request(app).get(`/api/employees/${r.id}/award-cap`).set(bearer(otherManagerToken));
    expect(res.status).toBe(403);
    expect(otherManagerId).not.toBe(managerId);
  });
});
