import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, rewardsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { Fixtures, bearer, uniq } from "./helpers";

/**
 * Multi-photo rewards: imageUrls is the ordered source of truth (first =
 * cover); legacy imageUrl is always kept in sync with imageUrls[0], and
 * legacy rows (imageUrl only) fall back to a one-element array in responses.
 */
const fx = new Fixtures();

let adminToken: string;
const rewardIds: number[] = [];

async function createReward(payload: Record<string, unknown>) {
  const res = await request(app)
    .post("/api/rewards")
    .set(bearer(adminToken))
    .send({ name: uniq("photo-reward"), buckCost: 10, ...payload });
  if (res.body?.id) rewardIds.push(res.body.id);
  return res;
}

beforeAll(async () => {
  const admin = await fx.createAuthedEmployee("admin");
  adminToken = admin.token;
});

afterAll(async () => {
  if (rewardIds.length) {
    await db.delete(rewardsTable).where(inArray(rewardsTable.id, rewardIds));
  }
  await fx.cleanup();
});

describe("Reward photos", () => {
  it("create with imageUrls sets the first photo as cover", async () => {
    const res = await createReward({ imageUrls: ["/u/a", "/u/b", "/u/c"] });
    expect(res.status).toBe(201);
    expect(res.body.imageUrls).toEqual(["/u/a", "/u/b", "/u/c"]);
    expect(res.body.imageUrl).toBe("/u/a");
  });

  it("conflicting create payload (empty imageUrls + legacy imageUrl) canonicalizes to no photos", async () => {
    const res = await createReward({ imageUrls: [], imageUrl: "/u/legacy" });
    expect(res.status).toBe(201);
    expect(res.body.imageUrls).toEqual([]);
    expect(res.body.imageUrl).toBeNull();
  });

  it("legacy create with only imageUrl seeds the photo array", async () => {
    const res = await createReward({ imageUrl: "/u/only" });
    expect(res.status).toBe(201);
    expect(res.body.imageUrls).toEqual(["/u/only"]);
    expect(res.body.imageUrl).toBe("/u/only");
  });

  it("reordering photos via update moves the cover", async () => {
    const created = await createReward({ imageUrls: ["/u/1", "/u/2"] });
    const res = await request(app)
      .patch(`/api/rewards/${created.body.id}`)
      .set(bearer(adminToken))
      .send({ imageUrls: ["/u/2", "/u/1"] });
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toBe("/u/2");
    expect(res.body.imageUrls).toEqual(["/u/2", "/u/1"]);
  });

  it("legacy imageUrl-only update backfills the array", async () => {
    const created = await createReward({ imageUrls: ["/u/old"] });
    const res = await request(app)
      .patch(`/api/rewards/${created.body.id}`)
      .set(bearer(adminToken))
      .send({ imageUrl: "/u/new" });
    expect(res.status).toBe(200);
    expect(res.body.imageUrls).toEqual(["/u/new"]);
    expect(res.body.imageUrl).toBe("/u/new");
  });

  it("rejects more than 8 photos", async () => {
    const res = await createReward({
      imageUrls: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    });
    expect(res.status).toBe(400);
  });

  it("legacy DB row (imageUrl set, empty array) falls back in responses", async () => {
    const created = await createReward({});
    await db
      .update(rewardsTable)
      .set({ imageUrls: [], imageUrl: "/u/legacy-row" })
      .where(eq(rewardsTable.id, created.body.id));
    const res = await request(app)
      .get(`/api/rewards/${created.body.id}`)
      .set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.imageUrls).toEqual(["/u/legacy-row"]);
    expect(res.body.imageUrl).toBe("/u/legacy-row");
  });
});
