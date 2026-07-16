import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, transactionsTable, rewardsTable, redemptionsTable, employeesTable } from "@workspace/db";
import { inArray, or, eq } from "drizzle-orm";
import { Fixtures, bearer, uniq } from "./helpers";

/**
 * Manager approval tier for redemptions: a manager may approve/reject (and
 * see) redemptions only from their own reporting subtree; fulfillment stays
 * admin-only; CAD values stay hidden from managers.
 */
const fx = new Fixtures();

let adminToken: string;
let managerToken: string;
let managerId: number;
let directToken: string;
let directId: number;
let indirectId: number;
let outsiderId: number;

let rewardId: number;
const redemptionIds: number[] = [];
const CAD_CENTS = 5678;

async function seedRedemption(employeeId: number) {
  const [r] = await db
    .insert(redemptionsTable)
    .values({ employeeId, rewardId, status: "requested", buckCost: 10, cadValueCents: CAD_CENTS })
    .returning();
  redemptionIds.push(r.id);
  return r;
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;

  const mgr = await fx.createAuthedEmployee("manager");
  managerToken = mgr.token;
  managerId = mgr.emp.id;

  const direct = await fx.createAuthedEmployee("team_member");
  directToken = direct.token;
  directId = direct.emp.id;

  const indirect = await fx.createAuthedEmployee("team_member");
  indirectId = indirect.emp.id;

  const outsider = await fx.createAuthedEmployee("team_member");
  outsiderId = outsider.emp.id;

  // Org tree: manager -> direct -> indirect; outsider reports to no one.
  await db.update(employeesTable).set({ managerId }).where(eq(employeesTable.id, directId));
  await db.update(employeesTable).set({ managerId: directId }).where(eq(employeesTable.id, indirectId));

  const [reward] = await db
    .insert(rewardsTable)
    .values({ name: uniq("mgr-approval-reward"), buckCost: 10, cadValueCents: CAD_CENTS, active: true, quantity: 5 })
    .returning();
  rewardId = reward.id;
});

afterAll(async () => {
  if (redemptionIds.length) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.redemptionId, redemptionIds));
    await db.delete(redemptionsTable).where(inArray(redemptionsTable.id, redemptionIds));
  }
  if (rewardId) await db.delete(rewardsTable).where(eq(rewardsTable.id, rewardId));
  await fx.cleanup();
});

describe("Manager redemption approval — subtree scoping", () => {
  it("manager list only contains own + subtree redemptions, with CAD hidden", async () => {
    const inScope = await seedRedemption(directId);
    const outScope = await seedRedemption(outsiderId);

    const res = await request(app).get("/api/redemptions").set(bearer(managerToken));
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: number }) => r.id);
    expect(ids).toContain(inScope.id);
    expect(ids).not.toContain(outScope.id);
    const row = res.body.find((r: { id: number }) => r.id === inScope.id);
    expect(row.cadValueCents).toBeNull();
  });

  it("manager can view a subtree redemption detail but not an outsider's", async () => {
    const inScope = await seedRedemption(indirectId);
    const outScope = await seedRedemption(outsiderId);

    const ok = await request(app).get(`/api/redemptions/${inScope.id}`).set(bearer(managerToken));
    expect(ok.status).toBe(200);
    expect(ok.body.cadValueCents).toBeNull();

    const denied = await request(app).get(`/api/redemptions/${outScope.id}`).set(bearer(managerToken));
    expect(denied.status).toBe(403);
  });

  it("manager can approve a direct report's request", async () => {
    const r = await seedRedemption(directId);
    const res = await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(managerToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.cadValueCents).toBeNull();
  });

  it("manager can reject an indirect report's request, which refunds the bucks", async () => {
    const r = await seedRedemption(indirectId);
    const res = await request(app)
      .patch(`/api/redemptions/${r.id}/reject`)
      .set(bearer(managerToken))
      .send({ adminNote: "not this one" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.adminNote).toBe("not this one");

    const refunds = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.redemptionId, r.id));
    expect(refunds.some((t) => t.type === "refund" && t.toEmployeeId === indirectId && t.amount === 10)).toBe(true);
  });

  it("manager cannot approve an out-of-subtree request (403)", async () => {
    const r = await seedRedemption(outsiderId);
    const res = await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(managerToken));
    expect(res.status).toBe(403);
  });

  it("manager cannot approve their own request (403)", async () => {
    const r = await seedRedemption(managerId);
    const res = await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(managerToken));
    expect(res.status).toBe(403);
  });

  it("manager cannot fulfill an approved request (403); admin can", async () => {
    const r = await seedRedemption(directId);
    await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(managerToken));

    const denied = await request(app).patch(`/api/redemptions/${r.id}/fulfill`).set(bearer(managerToken));
    expect(denied.status).toBe(403);

    const ok = await request(app).patch(`/api/redemptions/${r.id}/fulfill`).set(bearer(adminToken));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("fulfilled");
  });

  it("team member cannot approve anyone's request, even their own (403)", async () => {
    const r = await seedRedemption(directId);
    const res = await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(directToken));
    expect(res.status).toBe(403);
  });

  it("admin can approve any request regardless of reporting line, seeing CAD", async () => {
    const r = await seedRedemption(outsiderId);
    const res = await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.cadValueCents).toBe(CAD_CENTS);
  });
});
