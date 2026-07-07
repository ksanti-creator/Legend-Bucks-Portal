import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Fixtures, bearer, uniq } from "./helpers";

const fx = new Fixtures();

let adminToken: string;
let managerToken: string;
let memberToken: string;

beforeAll(async () => {
  ({ token: adminToken } = await fx.createAuthedEmployee("admin"));
  ({ token: managerToken } = await fx.createAuthedEmployee("manager"));
  ({ token: memberToken } = await fx.createAuthedEmployee("team_member"));
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Departments — admin-only writes", () => {
  it("rejects unauthenticated create/rename/delete with 401", async () => {
    const dept = await fx.createDepartment();
    expect((await request(app).post("/api/departments").send({ name: uniq("d") })).status).toBe(401);
    expect((await request(app).patch(`/api/departments/${dept.id}`).send({ name: uniq("d") })).status).toBe(401);
    expect((await request(app).delete(`/api/departments/${dept.id}`)).status).toBe(401);
  });

  it("forbids non-admins (manager & member) from creating", async () => {
    for (const token of [managerToken, memberToken]) {
      const res = await request(app).post("/api/departments").set(bearer(token)).send({ name: uniq("d") });
      expect(res.status).toBe(403);
    }
  });

  it("forbids non-admins from renaming and deleting", async () => {
    const dept = await fx.createDepartment();
    for (const token of [managerToken, memberToken]) {
      expect(
        (await request(app).patch(`/api/departments/${dept.id}`).set(bearer(token)).send({ name: uniq("d") })).status,
      ).toBe(403);
      expect((await request(app).delete(`/api/departments/${dept.id}`).set(bearer(token))).status).toBe(403);
    }
  });

  it("lets an admin create a department", async () => {
    const res = await request(app).post("/api/departments").set(bearer(adminToken)).send({ name: uniq("dept") });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    fx.trackDepartment(res.body.id);
  });

  it("returns 409 on duplicate name at create", async () => {
    const dept = await fx.createDepartment();
    const res = await request(app).post("/api/departments").set(bearer(adminToken)).send({ name: dept.name });
    expect(res.status).toBe(409);
  });

  it("returns 409 when renaming onto another department's name", async () => {
    const a = await fx.createDepartment();
    const b = await fx.createDepartment();
    const res = await request(app).patch(`/api/departments/${b.id}`).set(bearer(adminToken)).send({ name: a.name });
    expect(res.status).toBe(409);
  });

  it("returns 409 when deleting a department with assigned employees", async () => {
    const dept = await fx.createDepartment();
    await fx.createEmployee("team_member", { departmentId: dept.id });
    const res = await request(app).delete(`/api/departments/${dept.id}`).set(bearer(adminToken));
    expect(res.status).toBe(409);
  });

  it("lets an admin delete an empty department (204)", async () => {
    const dept = await fx.createDepartment();
    const res = await request(app).delete(`/api/departments/${dept.id}`).set(bearer(adminToken));
    expect(res.status).toBe(204);
  });
});

describe("Locations — admin-only writes", () => {
  it("forbids non-admins from create/rename/delete (403)", async () => {
    const loc = await fx.createLocation();
    for (const token of [managerToken, memberToken]) {
      expect((await request(app).post("/api/locations").set(bearer(token)).send({ name: uniq("l") })).status).toBe(403);
      expect(
        (await request(app).patch(`/api/locations/${loc.id}`).set(bearer(token)).send({ name: uniq("l") })).status,
      ).toBe(403);
      expect((await request(app).delete(`/api/locations/${loc.id}`).set(bearer(token))).status).toBe(403);
    }
  });

  it("lets an admin create a location and rejects duplicates (409)", async () => {
    const name = uniq("loc");
    const created = await request(app).post("/api/locations").set(bearer(adminToken)).send({ name });
    expect(created.status).toBe(201);
    fx.trackLocation(created.body.id);
    const dup = await request(app).post("/api/locations").set(bearer(adminToken)).send({ name });
    expect(dup.status).toBe(409);
  });

  it("returns 409 when deleting a location with assigned employees", async () => {
    const loc = await fx.createLocation();
    await fx.createEmployee("team_member", { locationId: loc.id });
    const res = await request(app).delete(`/api/locations/${loc.id}`).set(bearer(adminToken));
    expect(res.status).toBe(409);
  });
});

describe("Org id validation on employee writes", () => {
  it("returns 400 when updating an employee with a non-existent departmentId", async () => {
    const target = await fx.createEmployee("team_member");
    const res = await request(app)
      .patch(`/api/employees/${target.id}`)
      .set(bearer(adminToken))
      .send({ departmentId: 999999999 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when updating an employee with a non-existent locationId", async () => {
    const target = await fx.createEmployee("team_member");
    const res = await request(app)
      .patch(`/api/employees/${target.id}`)
      .set(bearer(adminToken))
      .send({ locationId: 999999999 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when inviting with a non-existent departmentId", async () => {
    const email = `${uniq("invite")}@example.test`;
    const res = await request(app)
      .post("/api/auth/invite")
      .set(bearer(adminToken))
      .send({
        email,
        firstName: "New",
        lastName: "Hire",
        role: "team_member",
        departmentId: 999999999,
      });
    expect(res.status).toBe(400);
    // The invite must have been rejected before any row was created. Assert
    // that, and track by the unique email only (never a broad firstName match)
    // so cleanup can't touch unrelated rows in the shared dev DB.
    const rows = await db.select().from(employeesTable).where(eq(employeesTable.email, email));
    expect(rows).toHaveLength(0);
    for (const r of rows) fx.employeeIds.push(r.id);
  });
});

describe("Employee listing filters by department/location id", () => {
  it("returns only employees in the requested department", async () => {
    const deptA = await fx.createDepartment();
    const deptB = await fx.createDepartment();
    const inA1 = await fx.createEmployee("team_member", { departmentId: deptA.id });
    const inA2 = await fx.createEmployee("team_member", { departmentId: deptA.id });
    await fx.createEmployee("team_member", { departmentId: deptB.id });

    const res = await request(app).get(`/api/employees?departmentId=${deptA.id}`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: number }) => e.id).sort();
    expect(ids).toEqual([inA1.id, inA2.id].sort());
    expect(res.body.every((e: { departmentId: number }) => e.departmentId === deptA.id)).toBe(true);
  });

  it("returns only employees in the requested location", async () => {
    const locA = await fx.createLocation();
    const locB = await fx.createLocation();
    const inA = await fx.createEmployee("team_member", { locationId: locA.id });
    await fx.createEmployee("team_member", { locationId: locB.id });

    const res = await request(app).get(`/api/employees?locationId=${locA.id}`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: number }) => e.id);
    expect(ids).toEqual([inA.id]);
  });
});
