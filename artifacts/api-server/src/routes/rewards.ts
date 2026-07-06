import { Router } from "express";
import type { IRouter } from "express";
import { db, rewardsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListRewardsQueryParams,
  ListRewardsResponse,
  CreateRewardBody,
  CreateRewardResponse,
  GetRewardParams,
  GetRewardResponse,
  UpdateRewardParams,
  UpdateRewardBody,
  UpdateRewardResponse,
  DeleteRewardParams,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

function rewardToResponse(r: any, isAdmin: boolean) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    buckCost: r.buckCost,
    // CAD value is accounting-only: only expose it to admins, never to regular staff.
    cadValueCents: isAdmin ? (r.cadValueCents ?? null) : null,
    imageUrl: r.imageUrl,
    quantity: r.quantity,
    locationRestriction: r.locationRestriction,
    active: r.active,
    approvalRequired: r.approvalRequired,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/rewards", requireAuth, async (req, res): Promise<void> => {
  const params = ListRewardsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const user = getCurrentUser(req);
  let rewards = await db.select().from(rewardsTable).orderBy(rewardsTable.name);

  // Non-admins only see active rewards
  if (user.role !== "admin") {
    rewards = rewards.filter((r) => r.active);
  }

  if (params.data.category) rewards = rewards.filter((r) => r.category === params.data.category);
  if (params.data.location) rewards = rewards.filter((r) => !r.locationRestriction || r.locationRestriction === params.data.location);
  if (params.data.active !== undefined) rewards = rewards.filter((r) => r.active === params.data.active);

  const isAdmin = user.role === "admin";
  res.json(ListRewardsResponse.parse(rewards.map((r) => rewardToResponse(r, isAdmin))));
});

router.post("/rewards", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = CreateRewardBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [reward] = await db
    .insert(rewardsTable)
    .values({
      name: body.data.name,
      description: body.data.description ?? null,
      category: body.data.category ?? null,
      buckCost: body.data.buckCost,
      cadValueCents: body.data.cadValueCents ?? null,
      imageUrl: body.data.imageUrl ?? null,
      quantity: body.data.quantity ?? null,
      locationRestriction: body.data.locationRestriction ?? null,
      active: body.data.active ?? true,
      approvalRequired: body.data.approvalRequired ?? false,
    })
    .returning();

  res.status(201).json(CreateRewardResponse.parse(rewardToResponse(reward, true)));
});

router.get("/rewards/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetRewardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, params.data.id)).limit(1);
  if (!reward) {
    res.status(404).json({ error: "Reward not found" });
    return;
  }

  const user = getCurrentUser(req);
  res.json(GetRewardResponse.parse(rewardToResponse(reward, user.role === "admin")));
});

router.patch("/rewards/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = UpdateRewardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateRewardBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updates: Record<string, any> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if ("description" in body.data) updates.description = body.data.description;
  if ("category" in body.data) updates.category = body.data.category;
  if (body.data.buckCost !== undefined) updates.buckCost = body.data.buckCost;
  if ("cadValueCents" in body.data) updates.cadValueCents = body.data.cadValueCents;
  if ("imageUrl" in body.data) updates.imageUrl = body.data.imageUrl;
  if ("quantity" in body.data) updates.quantity = body.data.quantity;
  if ("locationRestriction" in body.data) updates.locationRestriction = body.data.locationRestriction;
  if (body.data.active !== undefined) updates.active = body.data.active;
  if (body.data.approvalRequired !== undefined) updates.approvalRequired = body.data.approvalRequired;

  const [updated] = await db
    .update(rewardsTable)
    .set(updates)
    .where(eq(rewardsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Reward not found" });
    return;
  }

  res.json(UpdateRewardResponse.parse(rewardToResponse(updated, true)));
});

router.delete("/rewards/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = DeleteRewardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db.delete(rewardsTable).where(eq(rewardsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Reward not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
