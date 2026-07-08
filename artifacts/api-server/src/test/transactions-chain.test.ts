import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import request from "supertest";
import app from "../app";
import { Fixtures, bearer } from "./helpers";

/**
 * Management-chain authority and visibility.
 *
 * The org is a recursive `manager_id` tree. A senior manager (a manager of
 * managers) has authority over their whole subtree, and the per-employee award
 * cap is shared across the recipient's entire management chain — nobody in the
 * chain can bypass it by routing awards through a report.
 *
 * Tree used by these tests:
 *   top  ──manages──▶  mid  ──manages──▶  leaf (a team member)
 */
const fx = new Fixtures();

let adminToken: string;
let topId: number;
let topToken: string;
let midId: number;
let midToken: string;
let leafId: number;
let outsiderId: number;
let outsiderToken: string;

async function setManager(employeeId: number, managerId: number | null) {
  await db.update(employeesTable).set({ managerId }).where(eq(employeesTable.id, employeeId));
}

async function setCap(employeeId: number, cap: number | null) {
  const res = await request(app)
    .patch(`/api/employees/${employeeId}`)
    .set(bearer(adminToken))
    .send({ awardCapYearly: cap });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;

  const top = await fx.createAuthedEmployee("manager");
  topId = top.emp.id;
  topToken = top.token;

  const mid = await fx.createAuthedEmployee("manager");
  midId = mid.emp.id;
  midToken = mid.token;

  const leaf = await fx.createEmployee("team_member");
  leafId = leaf.id;

  const outsider = await fx.createAuthedEmployee("manager");
  outsiderId = outsider.emp.id;
  outsiderToken = outsider.token;

  // Build the chain: top → mid → leaf.
  await setManager(midId, topId);
  await setManager(leafId, midId);
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Indirect-report award authority", () => {
  it("lets a senior manager award an indirect report (report of their report)", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(topToken))
      .send({ toEmployeeId: leafId, amount: 25 });
    expect(res.status).toBe(201);
  });
});

describe("Shared chain-wide award cap", () => {
  it("counts combined awards from the whole chain and blocks any chain manager once exceeded", async () => {
    const leaf = await fx.createEmployee("team_member");
    await setManager(leaf.id, midId); // top → mid → leaf
    await setCap(leaf.id, 100);

    // Direct manager awards 60.
    const first = await request(app)
      .post("/api/transactions")
      .set(bearer(midToken))
      .send({ toEmployeeId: leaf.id, amount: 60 });
    expect(first.status).toBe(201);

    // Senior manager tries 60 more → chain total 120 > 100 → blocked.
    const second = await request(app)
      .post("/api/transactions")
      .set(bearer(topToken))
      .send({ toEmployeeId: leaf.id, amount: 60 });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/cap/i);

    // Senior manager awards exactly the remaining 40 → chain total 100 → allowed.
    const third = await request(app)
      .post("/api/transactions")
      .set(bearer(topToken))
      .send({ toEmployeeId: leaf.id, amount: 40 });
    expect(third.status).toBe(201);
  });

  it("does not cap a manager outside the recipient's chain", async () => {
    const leaf = await fx.createEmployee("team_member");
    await setManager(leaf.id, midId);
    await setCap(leaf.id, 10);

    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(outsiderToken))
      .send({ toEmployeeId: leaf.id, amount: 5000 });
    expect(res.status).toBe(201);
    expect(outsiderId).not.toBe(midId);
  });
});

describe("Chain-aware cap visibility", () => {
  it("lets a senior (ancestor) manager read an indirect report's cap + chain usage", async () => {
    const leaf = await fx.createEmployee("team_member");
    await setManager(leaf.id, midId);
    await setCap(leaf.id, 100);

    // Direct manager awards 30 → shows up as chain usage for the senior manager.
    await request(app)
      .post("/api/transactions")
      .set(bearer(midToken))
      .send({ toEmployeeId: leaf.id, amount: 30 });

    const res = await request(app).get(`/api/employees/${leaf.id}/award-cap`).set(bearer(topToken));
    expect(res.status).toBe(200);
    expect(res.body.cap).toBe(100);
    expect(res.body.usedThisYear).toBe(30);
    expect(res.body.remaining).toBe(70);
  });

  it("forbids a manager outside the chain from reading the cap", async () => {
    const leaf = await fx.createEmployee("team_member");
    await setManager(leaf.id, midId);
    await setCap(leaf.id, 100);

    const res = await request(app).get(`/api/employees/${leaf.id}/award-cap`).set(bearer(outsiderToken));
    expect(res.status).toBe(403);
  });
});

describe("Subtree roll-up in the employee listing", () => {
  it("returns direct AND indirect reports when filtering by a senior manager", async () => {
    const res = await request(app).get(`/api/employees?managerId=${topId}`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((e) => e.id);
    expect(ids).toContain(midId); // direct report
    expect(ids).toContain(leafId); // indirect report
    expect(ids).not.toContain(topId); // the manager themselves is excluded
  });
});

describe("Cycle safety", () => {
  it("resolves the chain without hanging when manager_id forms a loop", async () => {
    const a = await fx.createEmployee("manager");
    const b = await fx.createEmployee("team_member");
    // Create a cycle: a → b → a.
    await setManager(a.id, b.id);
    await setManager(b.id, a.id);
    await setCap(b.id, 50);

    // Reading b's cap resolves b's chain; must terminate (not loop forever).
    const res = await request(app).get(`/api/employees/${b.id}/award-cap`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.cap).toBe(50);
  });
});
