import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, rewardsTable, rewardSizesTable, redemptionsTable, transactionsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { Fixtures, bearer, uniq } from "./helpers";

/**
 * Sized rewards: per-size stock is the source of truth for sized items.
 * Redeeming requires a valid, in-stock size and decrements that size's stock;
 * reject/cancel restores it. Non-sized rewards keep the pooled quantity.
 */
const fx = new Fixtures();

let adminToken: string;
let memberToken: string;
let memberId: number;
const rewardIds: number[] = [];

async function giveBucks(employeeId: number, amount: number) {
  await db.insert(transactionsTable).values({
    type: "adjustment",
    amount,
    fromEmployeeId: null,
    toEmployeeId: employeeId,
    note: "test grant",
  });
}

async function createSizedReward(sizes: { label: string; quantity?: number | null }[], extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/rewards")
    .set(bearer(adminToken))
    .send({ name: uniq("sized-reward"), buckCost: 10, sizes, ...extra });
  expect(res.status).toBe(201);
  rewardIds.push(res.body.id);
  return res.body;
}

async function getSizes(rewardId: number) {
  const res = await request(app).get(`/api/rewards/${rewardId}`).set(bearer(adminToken));
  return res.body.sizes as { label: string; quantity: number | null }[];
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;
  const member = await fx.createAuthedEmployee("team_member");
  memberToken = member.token;
  memberId = member.emp.id;
  await giveBucks(memberId, 1000);
});

afterAll(async () => {
  await db.delete(redemptionsTable).where(eq(redemptionsTable.employeeId, memberId));
  await db.delete(transactionsTable).where(eq(transactionsTable.toEmployeeId, memberId));
  await db.delete(transactionsTable).where(eq(transactionsTable.fromEmployeeId, memberId));
  if (rewardIds.length) {
    await db.delete(rewardsTable).where(inArray(rewardsTable.id, rewardIds));
  }
  await fx.cleanup();
});

describe("Reward sizes", () => {
  it("admin can define, edit, and remove size options", async () => {
    const reward = await createSizedReward([
      { label: "S", quantity: 3 },
      { label: "M", quantity: null },
    ]);
    expect(reward.sizes).toEqual([
      { label: "S", quantity: 3 },
      { label: "M", quantity: null },
    ]);

    const patched = await request(app)
      .patch(`/api/rewards/${reward.id}`)
      .set(bearer(adminToken))
      .send({ sizes: [{ label: "L", quantity: 2 }] });
    expect(patched.status).toBe(200);
    expect(patched.body.sizes).toEqual([{ label: "L", quantity: 2 }]);

    const cleared = await request(app)
      .patch(`/api/rewards/${reward.id}`)
      .set(bearer(adminToken))
      .send({ sizes: [] });
    expect(cleared.body.sizes).toEqual([]);
  });

  it("sized redemption requires a size and rejects invalid sizes", async () => {
    const reward = await createSizedReward([{ label: "M", quantity: 5 }]);

    const noSize = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id });
    expect(noSize.status).toBe(400);
    expect(noSize.body.error).toMatch(/size/i);

    const badSize = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id, sizeLabel: "XXL" });
    expect(badSize.status).toBe(400);
  });

  it("non-sized reward rejects a sizeLabel", async () => {
    const reward = await createSizedReward([], { quantity: 5 });
    const res = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id, sizeLabel: "M" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not have sizes/i);
  });

  it("happy path decrements the chosen size's stock and records the size", async () => {
    const reward = await createSizedReward([
      { label: "S", quantity: 2 },
      { label: "M", quantity: null },
    ]);

    const res = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id, sizeLabel: "S" });
    expect(res.status).toBe(201);
    expect(res.body.sizeLabel).toBe("S");

    const sizes = await getSizes(reward.id);
    expect(sizes).toEqual([
      { label: "S", quantity: 1 },
      { label: "M", quantity: null },
    ]);

    // Unlimited size never decrements
    const unlimited = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id, sizeLabel: "M" });
    expect(unlimited.status).toBe(201);
    expect((await getSizes(reward.id)).find((s) => s.label === "M")?.quantity).toBeNull();
  });

  it("out-of-stock size is rejected and no bucks move", async () => {
    const reward = await createSizedReward([
      { label: "S", quantity: 0 },
      { label: "M", quantity: 1 },
    ]);
    const before = await request(app).get("/api/auth/me").set(bearer(memberToken));

    const res = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id, sizeLabel: "S" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/out of stock/i);

    const after = await request(app).get("/api/auth/me").set(bearer(memberToken));
    expect(after.body.balance).toBe(before.body.balance);
  });

  it("rejecting a sized redemption restores that size's stock", async () => {
    const reward = await createSizedReward([{ label: "L", quantity: 1 }], { approvalRequired: true });

    const red = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id, sizeLabel: "L" });
    expect(red.status).toBe(201);
    expect((await getSizes(reward.id))[0].quantity).toBe(0);

    const rejected = await request(app)
      .patch(`/api/redemptions/${red.body.id}/reject`)
      .set(bearer(adminToken))
      .send({ adminNote: "no" });
    expect(rejected.status).toBe(200);
    expect((await getSizes(reward.id))[0].quantity).toBe(1);
  });

  it("cancelling a sized redemption restores that size's stock", async () => {
    const reward = await createSizedReward([{ label: "XL", quantity: 1 }], { approvalRequired: true });

    const red = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id, sizeLabel: "XL" });
    expect(red.status).toBe(201);
    expect((await getSizes(reward.id))[0].quantity).toBe(0);

    const cancelled = await request(app)
      .patch(`/api/redemptions/${red.body.id}/cancel`)
      .set(bearer(memberToken));
    expect(cancelled.status).toBe(200);
    expect((await getSizes(reward.id))[0].quantity).toBe(1);
  });

  it("sized reward with pooled quantity 0 still redeems from size stock", async () => {
    const reward = await createSizedReward([{ label: "M", quantity: 2 }], { quantity: 0 });
    const res = await request(app)
      .post("/api/redemptions")
      .set(bearer(memberToken))
      .send({ rewardId: reward.id, sizeLabel: "M" });
    expect(res.status).toBe(201);
    expect((await getSizes(reward.id))[0].quantity).toBe(1);
  });

  it("rejects duplicate size labels on create and update", async () => {
    const dupCreate = await request(app)
      .post("/api/rewards")
      .set(bearer(adminToken))
      .send({ name: uniq("dup-sizes"), buckCost: 10, sizes: [{ label: "M" }, { label: " m " }] });
    expect(dupCreate.status).toBe(400);
    expect(dupCreate.body.error).toMatch(/duplicate/i);

    const reward = await createSizedReward([{ label: "S", quantity: 1 }]);
    const dupPatch = await request(app)
      .patch(`/api/rewards/${reward.id}`)
      .set(bearer(adminToken))
      .send({ sizes: [{ label: "L" }, { label: "L" }] });
    expect(dupPatch.status).toBe(400);
    // Existing sizes untouched after rejected update
    expect(await getSizes(reward.id)).toEqual([{ label: "S", quantity: 1 }]);
  });

  it("deleting a reward cascades its size rows", async () => {
    const reward = await createSizedReward([{ label: "S", quantity: 1 }]);
    await request(app).delete(`/api/rewards/${reward.id}`).set(bearer(adminToken)).expect(204);
    const rows = await db.select().from(rewardSizesTable).where(eq(rewardSizesTable.rewardId, reward.id));
    expect(rows).toEqual([]);
  });
});
