import crypto from "crypto";
import {
  db,
  employeesTable,
  departmentsTable,
  locationsTable,
  sessionsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { createSession } from "../lib/auth";

/** Short unique suffix so fixtures never collide with real or leftover data. */
export function uniq(prefix = "test"): string {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

type Role = "admin" | "manager" | "team_member";

/**
 * Tracks every row a suite creates so afterAll can delete exactly those,
 * leaving the shared dev DB untouched otherwise.
 */
export class Fixtures {
  employeeIds: number[] = [];
  departmentIds: number[] = [];
  locationIds: number[] = [];
  private sessionTokens: string[] = [];

  async createEmployee(role: Role, opts: { departmentId?: number; locationId?: number } = {}) {
    const [emp] = await db
      .insert(employeesTable)
      .values({
        firstName: "Test",
        lastName: role,
        email: `${uniq(role)}@example.test`,
        role,
        status: "active",
        departmentId: opts.departmentId ?? null,
        locationId: opts.locationId ?? null,
      })
      .returning();
    this.employeeIds.push(emp.id);
    return emp;
  }

  /** Create an employee and an authenticated Bearer token for them. */
  async createAuthedEmployee(role: Role, opts: { departmentId?: number; locationId?: number } = {}) {
    const emp = await this.createEmployee(role, opts);
    const token = await createSession(emp.id);
    this.sessionTokens.push(token);
    return { emp, token };
  }

  async createDepartment(name = uniq("dept")) {
    const [d] = await db.insert(departmentsTable).values({ name }).returning();
    this.departmentIds.push(d.id);
    return d;
  }

  async createLocation(name = uniq("loc")) {
    const [l] = await db.insert(locationsTable).values({ name }).returning();
    this.locationIds.push(l.id);
    return l;
  }

  /** Track ids that endpoints (not the helper) created, so cleanup removes them too. */
  trackDepartment(id: number) {
    if (!this.departmentIds.includes(id)) this.departmentIds.push(id);
  }
  trackLocation(id: number) {
    if (!this.locationIds.includes(id)) this.locationIds.push(id);
  }

  async cleanup() {
    if (this.sessionTokens.length) {
      await db.delete(sessionsTable).where(inArray(sessionsTable.sessionToken, this.sessionTokens));
    }
    if (this.employeeIds.length) {
      await db.delete(employeesTable).where(inArray(employeesTable.id, this.employeeIds));
    }
    if (this.departmentIds.length) {
      await db.delete(departmentsTable).where(inArray(departmentsTable.id, this.departmentIds));
    }
    if (this.locationIds.length) {
      await db.delete(locationsTable).where(inArray(locationsTable.id, this.locationIds));
    }
  }
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
