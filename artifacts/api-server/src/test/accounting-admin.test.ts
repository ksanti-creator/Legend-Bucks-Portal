import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, transactionsTable, rewardsTable, redemptionsTable, goalsTable, goalContributionsTable } from "@workspace/db";
import { inArray, or } from "drizzle-orm";
import { Fixtures, bearer, uniq } from "./helpers";

const fx = new Fixtures();

let accountingToken: string;
let managerToken: string;
let memberToken: string;
let managerId: number;
let memberId: number;

// Rows this suite creates directly (not via Fixtures) — cleaned up in afterAll.
const txIds: number[] = [];
const rewardIds: number[] = [];
const redemptionIds: number[] = [];
const goalIds: number[] = [];

// A ledger transaction between two OTHER employees, so we can prove the
// accounting admin sees org-wide activity they're not a party to.
let seededTxId: number;
let seededRedemptionId: number;
let activeGoalId: number;
const CAD_CENTS = 12345;

beforeAll(async () => {
  const acct = await fx.createAuthedEmployee("accounting_admin");
  accountingToken = acct.token;

  const mgr = await fx.createAuthedEmployee("manager");
  managerToken = mgr.token;
  managerId = mgr.emp.id;

  const mem = await fx.createAuthedEmployee("team_member");
  memberToken = mem.token;
  memberId = mem.emp.id;

  // Seed an award between manager -> member (accounting admin is not involved).
  const [tx] = await db
    .insert(transactionsTable)
    .values({ type: "award", amount: 50, fromEmployeeId: managerId, toEmployeeId: memberId, note: uniq("acct-test-award") })
    .returning();
  seededTxId = tx.id;
  txIds.push(tx.id);

  // Seed a reward + redemption carrying a CAD (dollar) value.
  const [reward] = await db
    .insert(rewardsTable)
    .values({ name: uniq("acct-reward"), buckCost: 100, cadValueCents: CAD_CENTS, active: true })
    .returning();
  rewardIds.push(reward.id);

  const [redemption] = await db
    .insert(redemptionsTable)
    .values({ employeeId: memberId, rewardId: reward.id, status: "requested", buckCost: 100, cadValueCents: CAD_CENTS })
    .returning();
  seededRedemptionId = redemption.id;
  redemptionIds.push(redemption.id);

  // Give the member a spendable balance so we can prove balance-holders can
  // still contribute after the allow-list refactor.
  const [balanceTx] = await db
    .insert(transactionsTable)
    .values({ type: "award", amount: 1000, fromEmployeeId: managerId, toEmployeeId: memberId, note: uniq("acct-balance") })
    .returning();
  txIds.push(balanceTx.id);

  // An active goal the member can contribute to.
  const [goal] = await db
    .insert(goalsTable)
    .values({ name: uniq("acct-goal"), targetAmount: 500, active: true })
    .returning();
  activeGoalId = goal.id;
  goalIds.push(goal.id);
});

afterAll(async () => {
  // Delete every ledger row that touches a fixture employee — this covers both
  // rows we seeded and rows the endpoints created during positive-path tests.
  const empIds = fx.employeeIds;
  if (empIds.length) {
    await db
      .delete(transactionsTable)
      .where(or(inArray(transactionsTable.fromEmployeeId, empIds), inArray(transactionsTable.toEmployeeId, empIds)));
    await db.delete(goalContributionsTable).where(inArray(goalContributionsTable.employeeId, empIds));
  }
  if (redemptionIds.length) await db.delete(redemptionsTable).where(inArray(redemptionsTable.id, redemptionIds));
  // Redemptions created by the endpoint (positive path) reference fixture employees.
  if (empIds.length) await db.delete(redemptionsTable).where(inArray(redemptionsTable.employeeId, empIds));
  if (goalIds.length) await db.delete(goalsTable).where(inArray(goalsTable.id, goalIds));
  if (rewardIds.length) await db.delete(rewardsTable).where(inArray(rewardsTable.id, rewardIds));
  if (txIds.length) await db.delete(transactionsTable).where(inArray(transactionsTable.id, txIds));
  await fx.cleanup();
});

describe("Accounting admin — read/export access", () => {
  it("can list the full organization ledger, including transactions it is not a party to", async () => {
    const res = await request(app).get("/api/transactions?limit=200").set(bearer(accountingToken));
    expect(res.status).toBe(200);
    const ids = res.body.items.map((t: { id: number }) => t.id);
    expect(ids).toContain(seededTxId);
  });

  it("a team member does NOT see transactions between other people", async () => {
    const res = await request(app).get("/api/transactions?limit=200").set(bearer(memberToken));
    expect(res.status).toBe(200);
    // The seeded award involves the member as recipient, so it WOULD show. Prove
    // scoping instead: a member only sees rows they're a party to.
    const allOwn = res.body.items.every(
      (t: { fromEmployeeId: number | null; toEmployeeId: number | null }) =>
        t.fromEmployeeId === memberId || t.toEmployeeId === memberId,
    );
    expect(allOwn).toBe(true);
  });

  it("can export the ledger as CSV", async () => {
    const res = await request(app).get("/api/transactions/export").set(bearer(accountingToken));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("id,type,amount");
  });

  it("sees accounting-only CAD values on redemptions", async () => {
    const res = await request(app).get("/api/redemptions").set(bearer(accountingToken));
    expect(res.status).toBe(200);
    const seeded = res.body.find((r: { id: number }) => r.id === seededRedemptionId);
    expect(seeded).toBeDefined();
    expect(seeded.cadValueCents).toBe(CAD_CENTS);
  });

  it("a manager does NOT see CAD values on redemptions", async () => {
    const res = await request(app).get("/api/redemptions").set(bearer(managerToken));
    expect(res.status).toBe(200);
    const seeded = res.body.find((r: { id: number }) => r.id === seededRedemptionId);
    expect(seeded).toBeDefined();
    expect(seeded.cadValueCents).toBeNull();
  });
});

describe("Accounting admin — blocked from every write/admin action", () => {
  it("cannot send/award bucks (403)", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(accountingToken))
      .send({ toEmployeeId: memberId, amount: 10, note: "nope" });
    expect(res.status).toBe(403);
  });

  it("cannot create a reward (403)", async () => {
    const res = await request(app)
      .post("/api/rewards")
      .set(bearer(accountingToken))
      .send({ name: uniq("r"), buckCost: 10 });
    expect(res.status).toBe(403);
  });

  it("cannot create a department or location (403)", async () => {
    expect((await request(app).post("/api/departments").set(bearer(accountingToken)).send({ name: uniq("d") })).status).toBe(403);
    expect((await request(app).post("/api/locations").set(bearer(accountingToken)).send({ name: uniq("l") })).status).toBe(403);
  });

  it("cannot assign a budget (403)", async () => {
    const res = await request(app)
      .post("/api/budgets")
      .set(bearer(accountingToken))
      .send({ managerId, month: "2026-07", totalAmount: 500 });
    expect(res.status).toBe(403);
  });

  it("cannot invite an employee (403)", async () => {
    const res = await request(app)
      .post("/api/auth/invite")
      .set(bearer(accountingToken))
      .send({ email: `${uniq("i")}@example.test`, firstName: "No", lastName: "Way", role: "team_member" });
    expect(res.status).toBe(403);
  });

  it("cannot update an employee (403)", async () => {
    const res = await request(app)
      .patch(`/api/employees/${memberId}`)
      .set(bearer(accountingToken))
      .send({ role: "manager" });
    expect(res.status).toBe(403);
  });

  it("cannot contribute to a goal (403)", async () => {
    const res = await request(app)
      .post("/api/goals/999999/contribute")
      .set(bearer(accountingToken))
      .send({ amount: 5 });
    expect(res.status).toBe(403);
  });

  it("cannot redeem a reward / create a redemption (403)", async () => {
    const res = await request(app)
      .post("/api/redemptions")
      .set(bearer(accountingToken))
      .send({ rewardId: rewardIds[0] });
    expect(res.status).toBe(403);
  });

  it("cannot cancel a redemption (403)", async () => {
    const res = await request(app)
      .patch(`/api/redemptions/${seededRedemptionId}/cancel`)
      .set(bearer(accountingToken));
    expect(res.status).toBe(403);
  });

  it("cannot approve, reject, or fulfil a redemption (403)", async () => {
    expect((await request(app).patch(`/api/redemptions/${seededRedemptionId}/approve`).set(bearer(accountingToken))).status).toBe(403);
    expect((await request(app).patch(`/api/redemptions/${seededRedemptionId}/reject`).set(bearer(accountingToken)).send({})).status).toBe(403);
    expect((await request(app).patch(`/api/redemptions/${seededRedemptionId}/fulfill`).set(bearer(accountingToken))).status).toBe(403);
  });
});

// Guards against over-restricting: the allow-list must still let real
// balance-holders (team members) move their own bucks.
describe("Spend allow-list — balance holders can still move bucks", () => {
  it("lets a team member contribute to a goal", async () => {
    const res = await request(app)
      .post(`/api/goals/${activeGoalId}/contribute`)
      .set(bearer(memberToken))
      .send({ amount: 5 });
    expect(res.status).toBe(201);
  });
});
