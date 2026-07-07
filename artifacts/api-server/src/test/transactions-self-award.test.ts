import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { Fixtures, bearer } from "./helpers";

const fx = new Fixtures();

let adminId: number;
let adminToken: string;
let managerId: number;
let managerToken: string;
let recipientId: number;

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminId = admin.emp.id;
  adminToken = admin.token;

  const manager = await fx.createAuthedEmployee("manager");
  managerId = manager.emp.id;
  managerToken = manager.token;

  const recipient = await fx.createEmployee("team_member");
  recipientId = recipient.id;
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Send bucks — no self-awarding", () => {
  it("rejects an admin sending bucks to themselves with 400", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: adminId, amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it("rejects a manager sending bucks to themselves with 400 (before any budget check)", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(managerToken))
      .send({ toEmployeeId: managerId, amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it("does not create a self-award transaction row", async () => {
    // The admin has no budget cap, so if the guard were missing this would
    // succeed (201). A 400 proves the row was never inserted.
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: adminId, amount: 5000 });
    expect(res.status).toBe(400);
  });

  it("still allows an admin to award a different employee", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: recipientId, amount: 10 });
    expect(res.status).toBe(201);
    expect(res.body.toEmployeeId).toBe(recipientId);
  });
});
