import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("../lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/email")>(),
  sendTimeOffPayrollEmail: vi.fn().mockResolvedValue(undefined),
  sendTimeOffApprovedEmail: vi.fn().mockResolvedValue(undefined),
}));
import { sendTimeOffPayrollEmail, sendTimeOffApprovedEmail } from "../lib/email";
import request from "supertest";
import app from "../app";
import { db, transactionsTable, rewardsTable, rewardSizesTable, redemptionsTable, employeesTable } from "@workspace/db";
import { inArray, eq, and } from "drizzle-orm";
import { Fixtures, bearer, uniq } from "./helpers";

/**
 * Payroll sign-off tier for Time Off redemptions: after the normal approval,
 * a "Time Off"-category redemption stops at pending_payroll and only an
 * accounting admin (or admin) can move it to approved or reject it (refund +
 * stock restore). Non-Time-Off flows are unchanged.
 */
const fx = new Fixtures();

let adminToken: string;
let managerToken: string;
let managerId: number;
let acctToken: string;
let memberToken: string;
let memberId: number;

let timeOffRewardId: number;
let timeOffNoApprovalRewardId: number;
let sizedTimeOffRewardId: number;
let gearRewardId: number;
const redemptionIds: number[] = [];
const rewardIds: number[] = [];

async function seedRedemption(rewardId: number, status: string, sizeLabel: string | null = null) {
  const [r] = await db
    .insert(redemptionsTable)
    .values({ employeeId: memberId, rewardId, status: status as any, buckCost: 10, sizeLabel })
    .returning();
  redemptionIds.push(r.id);
  return r;
}

async function fund(employeeId: number, amount: number) {
  await db.insert(transactionsTable).values({ type: "award", amount, fromEmployeeId: null, toEmployeeId: employeeId, note: "test funding" });
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;

  const mgr = await fx.createAuthedEmployee("manager");
  managerToken = mgr.token;
  managerId = mgr.emp.id;

  const acct = await fx.createAuthedEmployee("accounting_admin");
  acctToken = acct.token;

  const member = await fx.createAuthedEmployee("team_member");
  memberToken = member.token;
  memberId = member.emp.id;
  await db.update(employeesTable).set({ managerId }).where(eq(employeesTable.id, memberId));

  const mkReward = async (values: Partial<typeof rewardsTable.$inferInsert>) => {
    const [reward] = await db
      .insert(rewardsTable)
      .values({ name: uniq("payroll-reward"), buckCost: 10, active: true, quantity: null, approvalRequired: true, ...values } as any)
      .returning();
    rewardIds.push(reward.id);
    return reward.id;
  };

  timeOffRewardId = await mkReward({ category: "Time Off" });
  timeOffNoApprovalRewardId = await mkReward({ category: "Time Off", approvalRequired: false });
  sizedTimeOffRewardId = await mkReward({ category: "Time Off" });
  gearRewardId = await mkReward({ category: "Gear" });

  await db.insert(rewardSizesTable).values({ rewardId: sizedTimeOffRewardId, label: "M", quantity: 2, sortOrder: 0 });
});

afterAll(async () => {
  if (redemptionIds.length) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.redemptionId, redemptionIds));
    await db.delete(redemptionsTable).where(inArray(redemptionsTable.id, redemptionIds));
  }
  if (rewardIds.length) {
    await db.delete(rewardSizesTable).where(inArray(rewardSizesTable.rewardId, rewardIds));
    await db.delete(rewardsTable).where(inArray(rewardsTable.id, rewardIds));
  }
  await fx.cleanup();
});

describe("Payroll approval for Time Off redemptions", () => {
  it("first-line approval of a Time Off redemption moves it to pending_payroll, not approved", async () => {
    vi.mocked(sendTimeOffPayrollEmail).mockClear();
    vi.mocked(sendTimeOffApprovedEmail).mockClear();
    const r = await seedRedemption(timeOffRewardId, "requested");
    const res = await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(managerToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_payroll");
    const [member] = await db.select().from(employeesTable).where(eq(employeesTable.id, memberId));
    expect(sendTimeOffPayrollEmail).toHaveBeenCalledWith(
      `${member.firstName} ${member.lastName}`, member.email, expect.any(String), null, r.id,
    );
    expect(sendTimeOffApprovedEmail).toHaveBeenCalledWith(member.email, member.firstName, expect.any(String));
    expect((await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(managerToken))).status).toBe(400);
    expect(sendTimeOffPayrollEmail).toHaveBeenCalledTimes(1);
    expect(sendTimeOffApprovedEmail).toHaveBeenCalledTimes(1);
  });

  it("a Time Off reward that skips first approval still stops at pending_payroll on redeem", async () => {
    await fund(memberId, 100);
    const res = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: timeOffNoApprovalRewardId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending_payroll");
    redemptionIds.push(res.body.id);
  });

  it("non-Time-Off approval flow is unchanged (requested -> approved)", async () => {
    const r = await seedRedemption(gearRewardId, "requested");
    const res = await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("manager cannot payroll-approve; team member cannot either (403)", async () => {
    const r = await seedRedemption(timeOffRewardId, "pending_payroll");
    const mgrRes = await request(app).patch(`/api/redemptions/${r.id}/payroll-approve`).set(bearer(managerToken));
    expect(mgrRes.status).toBe(403);
    const memberRes = await request(app).patch(`/api/redemptions/${r.id}/payroll-approve`).set(bearer(memberToken));
    expect(memberRes.status).toBe(403);
  });

  it("manager cannot payroll-reject, nor action pending_payroll via legacy endpoints", async () => {
    const r = await seedRedemption(timeOffRewardId, "pending_payroll");
    const rejectRes = await request(app).patch(`/api/redemptions/${r.id}/payroll-reject`).set(bearer(managerToken)).send({});
    expect(rejectRes.status).toBe(403);
    const legacyApprove = await request(app).patch(`/api/redemptions/${r.id}/approve`).set(bearer(managerToken));
    expect(legacyApprove.status).toBe(400); // not "requested"
    const legacyReject = await request(app).patch(`/api/redemptions/${r.id}/reject`).set(bearer(managerToken)).send({});
    expect(legacyReject.status).toBe(400); // not requested/approved
  });

  it("accounting admin can payroll-approve a pending_payroll redemption", async () => {
    const r = await seedRedemption(timeOffRewardId, "pending_payroll");
    const res = await request(app).patch(`/api/redemptions/${r.id}/payroll-approve`).set(bearer(acctToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("payroll-approve rejects redemptions not awaiting payroll (400)", async () => {
    const r = await seedRedemption(timeOffRewardId, "requested");
    const res = await request(app).patch(`/api/redemptions/${r.id}/payroll-approve`).set(bearer(acctToken));
    expect(res.status).toBe(400);
  });

  it("accounting admin payroll-reject refunds bucks and restores per-size stock", async () => {
    // simulate the redeem-time size decrement, then reject and expect restore
    await db
      .update(rewardSizesTable)
      .set({ quantity: 1 })
      .where(and(eq(rewardSizesTable.rewardId, sizedTimeOffRewardId), eq(rewardSizesTable.label, "M")));
    const r = await seedRedemption(sizedTimeOffRewardId, "pending_payroll", "M");

    const res = await request(app)
      .patch(`/api/redemptions/${r.id}/payroll-reject`)
      .set(bearer(acctToken))
      .send({ adminNote: "payroll declined" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.adminNote).toBe("payroll declined");

    const refunds = await db.select().from(transactionsTable).where(eq(transactionsTable.redemptionId, r.id));
    expect(refunds.some((t) => t.type === "refund" && t.toEmployeeId === memberId && t.amount === 10)).toBe(true);

    const [size] = await db
      .select()
      .from(rewardSizesTable)
      .where(and(eq(rewardSizesTable.rewardId, sizedTimeOffRewardId), eq(rewardSizesTable.label, "M")));
    expect(size.quantity).toBe(2);
  });

  it("pending_payroll redemptions cannot be fulfilled (400)", async () => {
    const r = await seedRedemption(timeOffRewardId, "pending_payroll");
    const res = await request(app).patch(`/api/redemptions/${r.id}/fulfill`).set(bearer(adminToken));
    expect(res.status).toBe(400);
  });

  it("admin can also payroll-approve", async () => {
    const r = await seedRedemption(timeOffRewardId, "pending_payroll");
    const res = await request(app).patch(`/api/redemptions/${r.id}/payroll-approve`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });
});
