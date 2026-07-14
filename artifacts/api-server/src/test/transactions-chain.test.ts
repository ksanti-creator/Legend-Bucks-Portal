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
 * managers) has authority over their whole subtree — every direct AND indirect
 * report beneath them.
 *
 * Tree used by these tests:
 *   top  ──manages──▶  mid  ──manages──▶  leaf (a team member)
 */
const fx = new Fixtures();

let adminToken: string;
let topId: number;
let topToken: string;
let midId: number;
let leafId: number;

async function setManager(employeeId: number, managerId: number | null) {
  await db.update(employeesTable).set({ managerId }).where(eq(employeesTable.id, employeeId));
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;

  const top = await fx.createAuthedEmployee("manager");
  topId = top.emp.id;
  topToken = top.token;

  const mid = await fx.createAuthedEmployee("manager");
  midId = mid.emp.id;

  const leaf = await fx.createEmployee("team_member");
  leafId = leaf.id;

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
  it("resolves the subtree without hanging when manager_id forms a loop", async () => {
    const a = await fx.createEmployee("manager");
    const b = await fx.createEmployee("team_member");
    // Create a cycle: a → b → a.
    await setManager(a.id, b.id);
    await setManager(b.id, a.id);

    // Rolling up a's subtree must terminate (not loop forever).
    const res = await request(app).get(`/api/employees?managerId=${a.id}`).set(bearer(adminToken));
    expect(res.status).toBe(200);
  });
});
