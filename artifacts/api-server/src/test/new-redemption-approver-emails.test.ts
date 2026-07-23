import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { db, transactionsTable, rewardsTable, redemptionsTable, employeesTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { Fixtures, bearer, uniq } from "./helpers";

// Mock only the approver-notification sender; keep everything else real but
// stub the employee receipt sender too so tests never hit Gmail.
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendNewRedemptionRequestEmail: vi.fn().mockResolvedValue(undefined),
    sendRedemptionReceiptEmail: vi.fn().mockResolvedValue(undefined),
  };
});

import app from "../app";
import { sendNewRedemptionRequestEmail } from "../lib/email";

const mockedSend = vi.mocked(sendNewRedemptionRequestEmail);

/**
 * Approver notification emails on redemption creation:
 * - all admins are notified; managers only when the redeemer is in their subtree
 * - the notifyNewRedemptionRequests opt-out is respected
 * - email failures never fail the redemption
 */
const fx = new Fixtures();

let adminEmp: any;
let optedOutAdmin: any;
let managerEmp: any;
let outsideManagerEmp: any;
let directToken: string;
let directId: number;
let rewardId: number;
const redemptionIds: number[] = [];

beforeAll(async () => {
  adminEmp = (await fx.createAuthedEmployee("admin")).emp;
  optedOutAdmin = (await fx.createAuthedEmployee("admin")).emp;
  await db.update(employeesTable).set({ notifyNewRedemptionRequests: false }).where(eq(employeesTable.id, optedOutAdmin.id));

  managerEmp = (await fx.createAuthedEmployee("manager")).emp;
  outsideManagerEmp = (await fx.createAuthedEmployee("manager")).emp;

  const direct = await fx.createAuthedEmployee("team_member");
  directToken = direct.token;
  directId = direct.emp.id;
  // direct reports to managerEmp; outsideManagerEmp has no relation to direct.
  await db.update(employeesTable).set({ managerId: managerEmp.id }).where(eq(employeesTable.id, directId));

  const [reward] = await db
    .insert(rewardsTable)
    .values({ name: uniq("notify-reward"), buckCost: 5, active: true, quantity: null, approvalRequired: true })
    .returning();
  rewardId = reward.id;

  // Fund the redeemer.
  await db.insert(transactionsTable).values({
    type: "award",
    amount: 1000,
    fromEmployeeId: adminEmp.id,
    toEmployeeId: directId,
    note: "test funding",
  });
});

afterAll(async () => {
  await db.delete(transactionsTable).where(inArray(transactionsTable.toEmployeeId, [directId]));
  if (redemptionIds.length) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.redemptionId, redemptionIds));
    await db.delete(redemptionsTable).where(inArray(redemptionsTable.id, redemptionIds));
  }
  await db.delete(transactionsTable).where(eq(transactionsTable.fromEmployeeId, directId));
  if (rewardId) await db.delete(rewardsTable).where(eq(rewardsTable.id, rewardId));
  await fx.cleanup();
});

beforeEach(() => {
  mockedSend.mockClear();
  mockedSend.mockResolvedValue(undefined);
});

async function redeem(note?: string) {
  const res = await request(app)
    .post("/api/redemptions")
    .set(bearer(directToken))
    .send({ rewardId, note });
  if (res.status === 201) redemptionIds.push(res.body.id);
  return res;
}

describe("New redemption approver notifications", () => {
  it("notifies opted-in admins and the redeemer's chain manager, not unrelated managers or opted-out admins", async () => {
    const res = await redeem("please and thanks");
    expect(res.status).toBe(201);

    const recipients = mockedSend.mock.calls.map((c) => c[0]);
    expect(recipients).toContain(adminEmp.email);
    expect(recipients).toContain(managerEmp.email);
    expect(recipients).not.toContain(optedOutAdmin.email);
    expect(recipients).not.toContain(outsideManagerEmp.email);

    // Content: employee name, reward name, buck cost, note — never CAD.
    const call = mockedSend.mock.calls.find((c) => c[0] === managerEmp.email)!;
    expect(call[2]).toContain("Test"); // employee first name
    expect(call[3]).toContain("notify-reward");
    expect(call[4]).toBe(5);
    expect(call[5]).toBe("please and thanks");
  });

  it("redemption still succeeds when approver emails fail", async () => {
    mockedSend.mockRejectedValue(new Error("gmail down"));
    const res = await redeem();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("requested");
    expect(mockedSend).toHaveBeenCalled();
  });
});
