import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { Fixtures, bearer } from "./helpers";
import { setMaxSingleAward } from "../lib/settings";

const fx = new Fixtures();

let adminToken: string;
let managerToken: string;
let teamMemberToken: string;
let accountingToken: string;
let recipientId: number;

beforeAll(async () => {
  adminToken = (await fx.createAuthedEmployee("admin")).token;
  managerToken = (await fx.createAuthedEmployee("manager")).token;
  teamMemberToken = (await fx.createAuthedEmployee("team_member")).token;
  accountingToken = (await fx.createAuthedEmployee("accounting_admin")).token;
  recipientId = (await fx.createEmployee("team_member")).id;
});

afterAll(async () => {
  // Global setting on the shared dev DB — always clear it so other suites
  // aren't affected.
  await setMaxSingleAward(null);
  await fx.cleanup();
});

describe("Send bucks — role guard (no per-user budget)", () => {
  it("lets an admin award with no budget configured", async () => {
    await setMaxSingleAward(null);
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: recipientId, amount: 250 });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(250);
  });

  it("lets a manager award with no budget configured", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(managerToken))
      .send({ toEmployeeId: recipientId, amount: 250 });
    expect(res.status).toBe(201);
  });

  it("blocks a team member from awarding with 403", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(teamMemberToken))
      .send({ toEmployeeId: recipientId, amount: 10 });
    expect(res.status).toBe(403);
  });

  it("blocks an accounting_admin from awarding with 403", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(accountingToken))
      .send({ toEmployeeId: recipientId, amount: 10 });
    expect(res.status).toBe(403);
  });
});

describe("Send bucks — global max single award still enforced", () => {
  it("rejects an award above the global maximum, even for an admin", async () => {
    await setMaxSingleAward(500);
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: recipientId, amount: 501 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum single award/i);
  });

  it("allows an award at or below the global maximum", async () => {
    await setMaxSingleAward(500);
    const res = await request(app)
      .post("/api/transactions")
      .set(bearer(adminToken))
      .send({ toEmployeeId: recipientId, amount: 500 });
    expect(res.status).toBe(201);
  });
});
