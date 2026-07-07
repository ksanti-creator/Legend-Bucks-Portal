import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db, goalsTable, goalContributionsTable, transactionsTable, teamBudgetsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app";
import { Fixtures, bearer } from "./helpers";

/**
 * Team (department) budget pools.
 *
 * Admins set a per-department yearly pool. Managers of that department (and
 * admins) award from the pool toward the department's team goals. Awards draw
 * the pool down and advance the goal only — they never credit an individual's
 * spendable balance. Personal contributions (spending your own bucks) are a
 * separate flow and don't touch the pool.
 */
const fx = new Fixtures();

let adminToken: string;
let deptA: number;
let deptB: number;
let managerA: { id: number; token: string };
let managerB: { id: number; token: string };
let memberA: { id: number; token: string };
let goalA: number; // linked to deptA
let goalNoDept: number; // company-wide
const createdGoalIds: number[] = [];

async function setBudget(departmentId: number, amount: number, token = adminToken) {
  return request(app).put(`/api/team-budgets/${departmentId}`).set(bearer(token)).send({ amount });
}

async function createGoal(departmentId: number | null): Promise<number> {
  const res = await request(app)
    .post("/api/goals")
    .set(bearer(adminToken))
    .send({ name: "Test Goal", targetAmount: 100000, departmentId });
  expect(res.status).toBe(201);
  createdGoalIds.push(res.body.id);
  return res.body.id;
}

async function balanceOf(employeeId: number): Promise<number> {
  const res = await request(app).get(`/api/employees/${employeeId}/balance`).set(bearer(adminToken));
  expect(res.status).toBe(200);
  return res.body.balance;
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;

  deptA = (await fx.createDepartment()).id;
  deptB = (await fx.createDepartment()).id;

  const mA = await fx.createAuthedEmployee("manager", { departmentId: deptA });
  managerA = { id: mA.emp.id, token: mA.token };
  const mB = await fx.createAuthedEmployee("manager", { departmentId: deptB });
  managerB = { id: mB.emp.id, token: mB.token };
  const tm = await fx.createAuthedEmployee("team_member", { departmentId: deptA });
  memberA = { id: tm.emp.id, token: tm.token };

  goalA = await createGoal(deptA);
  goalNoDept = await createGoal(null);
});

afterAll(async () => {
  if (createdGoalIds.length) {
    await db.delete(goalContributionsTable).where(inArray(goalContributionsTable.goalId, createdGoalIds));
    await db.delete(transactionsTable).where(inArray(transactionsTable.goalId, createdGoalIds));
    await db.delete(goalsTable).where(inArray(goalsTable.id, createdGoalIds));
  }
  if (fx.employeeIds.length) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.toEmployeeId, fx.employeeIds));
    await db.delete(transactionsTable).where(inArray(transactionsTable.fromEmployeeId, fx.employeeIds));
  }
  if (fx.departmentIds.length) {
    await db.delete(teamBudgetsTable).where(inArray(teamBudgetsTable.departmentId, fx.departmentIds));
  }
  await fx.cleanup();
});

describe("Team budgets — setting & visibility", () => {
  it("lets an admin set (upsert) a department's pool and returns used/remaining", async () => {
    const res = await setBudget(deptA, 1000);
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(1000);
    expect(res.body.used).toBe(0);
    expect(res.body.remaining).toBe(1000);

    // Upsert: setting again overwrites the amount, not appends.
    const again = await setBudget(deptA, 2000);
    expect(again.body.amount).toBe(2000);
  });

  it("forbids non-admins from setting a budget", async () => {
    const res = await setBudget(deptA, 500, managerA.token);
    expect(res.status).toBe(403);
  });

  it("lists every department's pool for admins", async () => {
    const res = await request(app).get("/api/team-budgets").set(bearer(adminToken));
    expect(res.status).toBe(200);
    const row = res.body.find((b: any) => b.departmentId === deptA);
    expect(row).toBeTruthy();
    expect(row.amount).toBe(2000);
  });

  it("forbids non-admins from listing all budgets", async () => {
    const res = await request(app).get("/api/team-budgets").set(bearer(managerA.token));
    expect(res.status).toBe(403);
  });

  it("lets a manager view their own department's pool", async () => {
    const res = await request(app).get(`/api/team-budgets/${deptA}`).set(bearer(managerA.token));
    expect(res.status).toBe(200);
    expect(res.body.departmentId).toBe(deptA);
  });

  it("forbids a manager from viewing another department's pool", async () => {
    const res = await request(app).get(`/api/team-budgets/${deptA}`).set(bearer(managerB.token));
    expect(res.status).toBe(403);
  });

  it("forbids a team member from viewing a pool", async () => {
    const res = await request(app).get(`/api/team-budgets/${deptA}`).set(bearer(memberA.token));
    expect(res.status).toBe(403);
  });
});

describe("Team budgets — awarding toward goals", () => {
  it("draws the pool down, advances the goal, and never credits the awarding manager", async () => {
    await setBudget(deptA, 1000);
    const before = await balanceOf(managerA.id);

    const res = await request(app)
      .post(`/api/goals/${goalA}/award-from-budget`)
      .set(bearer(managerA.token))
      .send({ amount: 400 });
    expect(res.status).toBe(201);
    expect(res.body.currentAmount).toBe(400);

    const budget = await request(app).get(`/api/team-budgets/${deptA}`).set(bearer(adminToken));
    expect(budget.body.used).toBe(400);
    expect(budget.body.remaining).toBe(600);

    // The award funds the goal only — the manager's own balance is unchanged.
    expect(await balanceOf(managerA.id)).toBe(before);
  });

  it("blocks an award that exceeds the remaining pool", async () => {
    await setBudget(deptA, 1000); // used is 400 from the previous test
    const res = await request(app)
      .post(`/api/goals/${goalA}/award-from-budget`)
      .set(bearer(managerA.token))
      .send({ amount: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budget/i);
  });

  it("forbids a manager awarding from another department's pool", async () => {
    const res = await request(app)
      .post(`/api/goals/${goalA}/award-from-budget`)
      .set(bearer(managerB.token))
      .send({ amount: 10 });
    expect(res.status).toBe(403);
  });

  it("lets an admin award from any department's pool", async () => {
    const res = await request(app)
      .post(`/api/goals/${goalA}/award-from-budget`)
      .set(bearer(adminToken))
      .send({ amount: 50 });
    expect(res.status).toBe(201);
  });

  it("still lists the ledger without error after a team-budget award (enum regression)", async () => {
    // A prior award created a team_goal_award transaction. Listing must not 500
    // because the response schema knows that transaction type.
    const res = await request(app).get("/api/transactions").set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.items.some((t: any) => t.type === "team_goal_award")).toBe(true);
  });

  it("rejects awarding to a goal with no department", async () => {
    await setBudget(deptA, 1000);
    const res = await request(app)
      .post(`/api/goals/${goalNoDept}/award-from-budget`)
      .set(bearer(adminToken))
      .send({ amount: 10 });
    expect(res.status).toBe(404);
  });

  it("forbids a team member from awarding from the pool", async () => {
    const res = await request(app)
      .post(`/api/goals/${goalA}/award-from-budget`)
      .set(bearer(memberA.token))
      .send({ amount: 10 });
    expect(res.status).toBe(403);
  });
});

describe("Team budgets — concurrency safety", () => {
  let deptC: number;
  let managerC: { id: number; token: string };

  beforeAll(async () => {
    deptC = (await fx.createDepartment()).id;
    const m = await fx.createAuthedEmployee("manager", { departmentId: deptC });
    managerC = { id: m.emp.id, token: m.token };
  });

  it("never overspends the pool when two awards land at the same moment", async () => {
    const goalC = await createGoal(deptC);
    await setBudget(deptC, 100);

    // Both awards would fit alone (60 <= 100) but not together (120 > 100).
    const [a, b] = await Promise.all([
      request(app).post(`/api/goals/${goalC}/award-from-budget`).set(bearer(managerC.token)).send({ amount: 60 }),
      request(app).post(`/api/goals/${goalC}/award-from-budget`).set(bearer(managerC.token)).send({ amount: 60 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);

    const budget = await request(app).get(`/api/team-budgets/${deptC}`).set(bearer(adminToken));
    expect(budget.body.used).toBe(60);
  });

  it("counts every concurrent award toward goal progress (no lost update)", async () => {
    const goalC = await createGoal(deptC);
    await setBudget(deptC, 100000);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/api/goals/${goalC}/award-from-budget`).set(bearer(managerC.token)).send({ amount: 100 }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const goal = await request(app).get(`/api/goals/${goalC}`).set(bearer(managerC.token));
    expect(goal.body.currentAmount).toBe(500);
  });
});

describe("Team budgets — personal contributions stay separate", () => {
  it("spends the contributor's own balance and does not touch the pool", async () => {
    // Give the team member some spendable bucks.
    const award = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: memberA.id, amount: 300 });
    expect(award.status).toBe(201);

    await setBudget(deptA, 1000);
    const poolBefore = (await request(app).get(`/api/team-budgets/${deptA}`).set(bearer(adminToken))).body.used;

    const contribute = await request(app)
      .post(`/api/goals/${goalA}/contribute`)
      .set(bearer(memberA.token))
      .send({ amount: 100 });
    expect(contribute.status).toBe(201);

    // Contributor's balance dropped...
    expect(await balanceOf(memberA.id)).toBe(200);
    // ...but the team pool usage is unchanged (contributions aren't pool draws).
    const poolAfter = (await request(app).get(`/api/team-budgets/${deptA}`).set(bearer(adminToken))).body.used;
    expect(poolAfter).toBe(poolBefore);
  });
});
