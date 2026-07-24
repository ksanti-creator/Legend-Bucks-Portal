import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db, employeesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import app from "../app";
import { Fixtures, uniq, bearer } from "./helpers";

/**
 * Bulk invite (spreadsheet upload) endpoint:
 * - admin-only
 * - per-row results with partial success
 * - in-batch duplicates and existing emails are skipped, valid rows go through
 * - retrying the same batch never double-invites
 */
describe("POST /api/auth/bulk-invite", () => {
  const fx = new Fixtures();
  let adminToken: string;
  let memberToken: string;
  let manager: { id: number; email: string };
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const admin = await fx.createAuthedEmployee("admin");
    adminToken = admin.token;
    const member = await fx.createAuthedEmployee("team_member");
    memberToken = member.token;
    manager = await fx.createEmployee("manager");
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(employeesTable).where(inArray(employeesTable.email, createdEmails));
    }
    await fx.cleanup();
  });

  function row(overrides: Record<string, unknown> = {}) {
    const email = `${uniq("bulk")}@example.test`;
    createdEmails.push(email);
    return {
      firstName: "Bulk",
      lastName: "Invitee",
      email,
      role: "team_member",
      ...overrides,
    };
  }

  it("rejects non-admins", async () => {
    const res = await request(app)
      .post("/api/auth/bulk-invite")
      .set(bearer(memberToken))
      .send({ invites: [row()] });
    expect(res.status).toBe(403);
  });

  it("invites valid rows and skips duplicates/existing with per-row results", async () => {
    const a = row();
    const dupOfA = { ...a }; // duplicate within batch
    const existing = row({ email: manager.email }); // already in system
    const badManager = row({ managerId: 99999999 });
    const withManager = row({ managerId: manager.id, role: "manager", awardBudgetYearly: 5000 });

    const res = await request(app)
      .post("/api/auth/bulk-invite")
      .set(bearer(adminToken))
      .send({ invites: [a, dupOfA, existing, badManager, withManager] });

    expect(res.status).toBe(200);
    expect(res.body.invitedCount).toBe(2);
    expect(res.body.skippedCount).toBe(3);
    const byIndex = Object.fromEntries(res.body.results.map((r: any) => [r.index, r]));
    expect(byIndex[0].status).toBe("invited");
    expect(byIndex[1].status).toBe("skipped");
    expect(byIndex[1].error).toMatch(/duplicate/i);
    expect(byIndex[2].status).toBe("skipped");
    expect(byIndex[2].error).toMatch(/already exists/i);
    expect(byIndex[3].status).toBe("skipped");
    expect(byIndex[3].error).toMatch(/manager/i);
    expect(byIndex[4].status).toBe("invited");

    // Invited employee persisted with invited status and manager set
    const [saved] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.email, withManager.email as string));
    expect(saved.status).toBe("invited");
    expect(saved.managerId).toBe(manager.id);
    expect(saved.awardBudgetYearly).toBe(5000);
  });

  it("enforces role/budget and manager-role rules server-side", async () => {
    const member = await fx.createEmployee("team_member");
    const budgetOnMember = row({ awardBudgetYearly: 1000 }); // team_member with budget
    const nonManagerBoss = row({ managerId: member.id }); // manager isn't manager/admin
    const accounting = row({ role: "accounting_admin" });

    const res = await request(app)
      .post("/api/auth/bulk-invite")
      .set(bearer(adminToken))
      .send({ invites: [budgetOnMember, nonManagerBoss, accounting] });

    expect(res.status).toBe(200);
    const byIndex = Object.fromEntries(res.body.results.map((r: any) => [r.index, r]));
    expect(byIndex[0].status).toBe("skipped");
    expect(byIndex[0].error).toMatch(/budget/i);
    expect(byIndex[1].status).toBe("skipped");
    expect(byIndex[1].error).toMatch(/manager or admin/i);
    expect(byIndex[2].status).toBe("invited");
  });

  it("retrying the same batch does not double-invite", async () => {
    const a = row();
    const first = await request(app)
      .post("/api/auth/bulk-invite")
      .set(bearer(adminToken))
      .send({ invites: [a] });
    expect(first.body.invitedCount).toBe(1);

    const retry = await request(app)
      .post("/api/auth/bulk-invite")
      .set(bearer(adminToken))
      .send({ invites: [a] });
    expect(retry.status).toBe(200);
    expect(retry.body.invitedCount).toBe(0);
    expect(retry.body.results[0].status).toBe("skipped");

    const rows = await db.select().from(employeesTable).where(eq(employeesTable.email, a.email as string));
    expect(rows.length).toBe(1);
  });
});
