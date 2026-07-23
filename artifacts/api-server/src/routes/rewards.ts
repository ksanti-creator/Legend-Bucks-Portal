import { Router } from "express";
import type { IRouter } from "express";
import { db, rewardsTable, rewardSizesTable } from "@workspace/db";
import { eq, inArray, asc } from "drizzle-orm";
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

// Fetch size variants for a set of rewards, keyed by rewardId, in display order.
async function getSizesByRewardId(rewardIds: number[]): Promise<Map<number, { label: string; quantity: number | null }[]>> {
  const map = new Map<number, { label: string; quantity: number | null }[]>();
  if (rewardIds.length === 0) return map;
  const rows = await db
    .select()
    .from(rewardSizesTable)
    .where(inArray(rewardSizesTable.rewardId, rewardIds))
    .orderBy(asc(rewardSizesTable.sortOrder), asc(rewardSizesTable.id));
  for (const row of rows) {
    const list = map.get(row.rewardId) ?? [];
    list.push({ label: row.label, quantity: row.quantity });
    map.set(row.rewardId, list);
  }
  return map;
}

// Validate size inputs: trimmed, non-empty, unique labels. Returns an error
// message or null. Duplicate labels would corrupt stock accounting (decrement/
// restore match by rewardId + label), so they are rejected up front.
function validateSizes(sizes: { label: string; quantity?: number | null }[]): string | null {
  const seen = new Set<string>();
  for (const s of sizes) {
    const label = s.label.trim();
    if (!label) return "Size labels cannot be blank";
    if (seen.has(label.toLowerCase())) return `Duplicate size label: ${label}`;
    seen.add(label.toLowerCase());
  }
  return null;
}

// Replace a reward's full set of size variants (in display order).
async function replaceSizes(rewardId: number, sizes: { label: string; quantity?: number | null }[]) {
  await db.delete(rewardSizesTable).where(eq(rewardSizesTable.rewardId, rewardId));
  if (sizes.length > 0) {
    await db.insert(rewardSizesTable).values(
      sizes.map((s, i) => ({ rewardId, label: s.label.trim(), quantity: s.quantity ?? null, sortOrder: i })),
    );
  }
}

function rewardToResponse(r: any, isAdmin: boolean, sizes: { label: string; quantity: number | null }[] = []) {
  // Legacy rewards may have imageUrl set but an empty imageUrls array.
  const imageUrls: string[] =
    r.imageUrls && r.imageUrls.length > 0 ? r.imageUrls : r.imageUrl ? [r.imageUrl] : [];
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    buckCost: r.buckCost,
    // CAD value is accounting-only: only expose it to admins, never to regular staff.
    cadValueCents: isAdmin ? (r.cadValueCents ?? null) : null,
    // Product code & serial number are internal inventory data: admins only.
    productCode: isAdmin ? (r.productCode ?? null) : null,
    serialNumber: isAdmin ? (r.serialNumber ?? null) : null,
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    quantity: r.quantity,
    locationRestriction: r.locationRestriction,
    active: r.active,
    approvalRequired: r.approvalRequired,
    sizes,
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
  const sizesMap = await getSizesByRewardId(rewards.map((r) => r.id));
  res.json(ListRewardsResponse.parse(rewards.map((r) => rewardToResponse(r, isAdmin, sizesMap.get(r.id) ?? []))));
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
      productCode: body.data.productCode ?? null,
      serialNumber: body.data.serialNumber ?? null,
      // imageUrls is the source of truth; imageUrl always mirrors the cover
      // photo (imageUrls[0]). Legacy imageUrl-only payloads seed the array.
      ...(() => {
        const imageUrls =
          body.data.imageUrls ?? (body.data.imageUrl ? [body.data.imageUrl] : []);
        return { imageUrls, imageUrl: imageUrls[0] ?? null };
      })(),
      quantity: body.data.quantity ?? null,
      locationRestriction: body.data.locationRestriction ?? null,
      active: body.data.active ?? true,
      approvalRequired: body.data.approvalRequired ?? false,
    })
    .returning();

  if (body.data.sizes && body.data.sizes.length > 0) {
    const sizeError = validateSizes(body.data.sizes);
    if (sizeError) {
      // Reward row was already created; remove it so a bad payload doesn't
      // leave a half-configured reward behind.
      await db.delete(rewardsTable).where(eq(rewardsTable.id, reward.id));
      res.status(400).json({ error: sizeError });
      return;
    }
    await replaceSizes(reward.id, body.data.sizes);
  }
  const sizesMap = await getSizesByRewardId([reward.id]);
  res.status(201).json(CreateRewardResponse.parse(rewardToResponse(reward, true, sizesMap.get(reward.id) ?? [])));
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
  const sizesMap = await getSizesByRewardId([reward.id]);
  res.json(GetRewardResponse.parse(rewardToResponse(reward, user.role === "admin", sizesMap.get(reward.id) ?? [])));
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

  if (body.data.sizes !== undefined) {
    const sizeError = validateSizes(body.data.sizes);
    if (sizeError) {
      res.status(400).json({ error: sizeError });
      return;
    }
  }

  const updates: Record<string, any> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if ("description" in body.data) updates.description = body.data.description;
  if ("category" in body.data) updates.category = body.data.category;
  if (body.data.buckCost !== undefined) updates.buckCost = body.data.buckCost;
  if ("cadValueCents" in body.data) updates.cadValueCents = body.data.cadValueCents;
  if ("productCode" in body.data) updates.productCode = body.data.productCode;
  if ("serialNumber" in body.data) updates.serialNumber = body.data.serialNumber;
  if ("imageUrls" in body.data && body.data.imageUrls !== undefined) {
    updates.imageUrls = body.data.imageUrls;
    updates.imageUrl = body.data.imageUrls[0] ?? null;
  } else if ("imageUrl" in body.data) {
    updates.imageUrl = body.data.imageUrl;
    updates.imageUrls = body.data.imageUrl ? [body.data.imageUrl] : [];
  }
  if ("quantity" in body.data) updates.quantity = body.data.quantity;
  if ("locationRestriction" in body.data) updates.locationRestriction = body.data.locationRestriction;
  if (body.data.active !== undefined) updates.active = body.data.active;
  if (body.data.approvalRequired !== undefined) updates.approvalRequired = body.data.approvalRequired;

  let updated;
  if (Object.keys(updates).length > 0) {
    [updated] = await db
      .update(rewardsTable)
      .set(updates)
      .where(eq(rewardsTable.id, params.data.id))
      .returning();
  } else {
    [updated] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, params.data.id)).limit(1);
  }

  if (!updated) {
    res.status(404).json({ error: "Reward not found" });
    return;
  }

  if (body.data.sizes !== undefined) {
    await replaceSizes(updated.id, body.data.sizes);
  }

  const sizesMap = await getSizesByRewardId([updated.id]);
  res.json(UpdateRewardResponse.parse(rewardToResponse(updated, true, sizesMap.get(updated.id) ?? [])));
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
