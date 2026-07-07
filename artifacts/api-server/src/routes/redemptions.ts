import { Router } from "express";
import type { IRouter } from "express";
import { db, redemptionsTable, rewardsTable, employeesTable, transactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListRedemptionsQueryParams,
  ListRedemptionsResponse,
  CreateRedemptionBody,
  CreateRedemptionResponse,
  GetRedemptionParams,
  GetRedemptionResponse,
  ApproveRedemptionParams,
  ApproveRedemptionResponse,
  RejectRedemptionParams,
  RejectRedemptionBody,
  RejectRedemptionResponse,
  CancelRedemptionParams,
  CancelRedemptionResponse,
  FulfillRedemptionParams,
  FulfillRedemptionResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser, getEmployeeBalance } from "../lib/auth";
import { sendRedemptionReceiptEmail } from "../lib/email";

const router: IRouter = Router();

async function enrichRedemption(r: any, isAdmin: boolean) {
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, r.employeeId)).limit(1);
  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, r.rewardId)).limit(1);
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
    rewardId: r.rewardId,
    rewardName: reward?.name ?? "Unknown",
    status: r.status,
    buckCost: r.buckCost,
    // CAD value is accounting-only: only expose it to admins, never to managers or staff.
    cadValueCents: isAdmin ? (r.cadValueCents ?? null) : null,
    note: r.note,
    adminNote: r.adminNote,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/redemptions", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = ListRedemptionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let all = await db.select().from(redemptionsTable).orderBy(redemptionsTable.createdAt);

  // Team members only see their own
  if (user.role === "team_member") {
    all = all.filter((r) => r.employeeId === user.id);
  } else if (params.data.employeeId !== undefined) {
    all = all.filter((r) => r.employeeId === params.data.employeeId);
  }

  if (params.data.status) all = all.filter((r) => r.status === params.data.status);
  if (params.data.pendingApproval) all = all.filter((r) => r.status === "requested");

  const enriched = await Promise.all(all.map((r) => enrichRedemption(r, user.role === "admin")));
  res.json(ListRedemptionsResponse.parse(enriched));
});

router.post("/redemptions", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const body = CreateRedemptionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, body.data.rewardId)).limit(1);
  if (!reward || !reward.active) {
    res.status(400).json({ error: "Reward not available" });
    return;
  }

  if (reward.quantity !== null && reward.quantity <= 0) {
    res.status(400).json({ error: "Reward is out of stock" });
    return;
  }

  const balance = await getEmployeeBalance(user.id);
  if (balance < reward.buckCost) {
    res.status(400).json({ error: `Insufficient balance. You have ${balance} bucks, reward costs ${reward.buckCost}` });
    return;
  }

  // Deduct bucks immediately via ledger
  await db.insert(transactionsTable).values({
    type: "redemption_debit",
    amount: reward.buckCost,
    fromEmployeeId: user.id,
    toEmployeeId: null,
    note: `Redemption: ${reward.name}`,
  });

  // Decrement quantity if limited
  if (reward.quantity !== null) {
    await db.update(rewardsTable).set({ quantity: reward.quantity - 1 }).where(eq(rewardsTable.id, reward.id));
  }

  const initialStatus = reward.approvalRequired ? "requested" : "approved";
  const [redemption] = await db
    .insert(redemptionsTable)
    .values({
      employeeId: user.id,
      rewardId: reward.id,
      status: initialStatus,
      buckCost: reward.buckCost,
      cadValueCents: reward.cadValueCents ?? null,
      note: body.data.note ?? null,
    })
    .returning();

  // Update transaction with redemption id
  await db.execute(
    `UPDATE transactions SET redemption_id = ${redemption.id} WHERE type = 'redemption_debit' AND from_employee_id = ${user.id} AND redemption_id IS NULL ORDER BY created_at DESC LIMIT 1`
  );

  // Email the employee a redemption receipt — best-effort, never blocks.
  if (user.email) {
    try {
      await sendRedemptionReceiptEmail(
        user.email,
        user.firstName,
        reward.name,
        redemption.buckCost,
        redemption.createdAt,
        redemption.status,
      );
      req.log.info({ redemptionId: redemption.id }, "Redemption receipt email sent");
    } catch (err) {
      req.log.error({ err, redemptionId: redemption.id }, "Failed to send redemption receipt email");
    }
  }

  res.status(201).json(CreateRedemptionResponse.parse(await enrichRedemption(redemption, user.role === "admin")));
});

router.get("/redemptions/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetRedemptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [redemption] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, params.data.id)).limit(1);
  if (!redemption) {
    res.status(404).json({ error: "Redemption not found" });
    return;
  }

  const user = getCurrentUser(req);
  if (user.role === "team_member" && redemption.employeeId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json(GetRedemptionResponse.parse(await enrichRedemption(redemption, user.role === "admin")));
});

router.patch("/redemptions/:id/approve", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = ApproveRedemptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [redemption] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, params.data.id)).limit(1);
  if (!redemption || redemption.status !== "requested") {
    res.status(400).json({ error: "Redemption cannot be approved" });
    return;
  }

  const [updated] = await db
    .update(redemptionsTable)
    .set({ status: "approved" })
    .where(eq(redemptionsTable.id, params.data.id))
    .returning();

  res.json(ApproveRedemptionResponse.parse(await enrichRedemption(updated, user.role === "admin")));
});

router.patch("/redemptions/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = RejectRedemptionParams.safeParse(req.params);
  const body = RejectRedemptionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [redemption] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, params.data.id)).limit(1);
  if (!redemption || !["requested", "approved"].includes(redemption.status)) {
    res.status(400).json({ error: "Redemption cannot be rejected" });
    return;
  }

  const [updated] = await db
    .update(redemptionsTable)
    .set({ status: "rejected", adminNote: body.data.adminNote ?? null })
    .where(eq(redemptionsTable.id, params.data.id))
    .returning();

  // Refund bucks
  await db.insert(transactionsTable).values({
    type: "refund",
    amount: redemption.buckCost,
    fromEmployeeId: null,
    toEmployeeId: redemption.employeeId,
    note: `Refund for rejected redemption #${redemption.id}`,
    redemptionId: redemption.id,
  });

  // Restore quantity
  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, redemption.rewardId)).limit(1);
  if (reward && reward.quantity !== null) {
    await db.update(rewardsTable).set({ quantity: reward.quantity + 1 }).where(eq(rewardsTable.id, reward.id));
  }

  res.json(RejectRedemptionResponse.parse(await enrichRedemption(updated, user.role === "admin")));
});

router.patch("/redemptions/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = CancelRedemptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [redemption] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, params.data.id)).limit(1);
  if (!redemption) {
    res.status(404).json({ error: "Redemption not found" });
    return;
  }

  // Only the employee themselves OR an admin can cancel — managers cannot cancel others' redemptions
  const isSelf = redemption.employeeId === user.id;
  const isAdmin = user.role === "admin";
  if (!isSelf && !isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!["requested"].includes(redemption.status)) {
    res.status(400).json({ error: "Only pending redemptions can be cancelled" });
    return;
  }

  const [updated] = await db
    .update(redemptionsTable)
    .set({ status: "cancelled" })
    .where(eq(redemptionsTable.id, params.data.id))
    .returning();

  // Refund bucks
  await db.insert(transactionsTable).values({
    type: "refund",
    amount: redemption.buckCost,
    fromEmployeeId: null,
    toEmployeeId: redemption.employeeId,
    note: `Refund for cancelled redemption #${redemption.id}`,
    redemptionId: redemption.id,
  });

  // Restore quantity
  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, redemption.rewardId)).limit(1);
  if (reward && reward.quantity !== null) {
    await db.update(rewardsTable).set({ quantity: reward.quantity + 1 }).where(eq(rewardsTable.id, reward.id));
  }

  res.json(CancelRedemptionResponse.parse(await enrichRedemption(updated, user.role === "admin")));
});

router.patch("/redemptions/:id/fulfill", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = FulfillRedemptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [redemption] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, params.data.id)).limit(1);
  if (!redemption || redemption.status !== "approved") {
    res.status(400).json({ error: "Only approved redemptions can be fulfilled" });
    return;
  }

  const [updated] = await db
    .update(redemptionsTable)
    .set({ status: "fulfilled" })
    .where(eq(redemptionsTable.id, params.data.id))
    .returning();

  res.json(FulfillRedemptionResponse.parse(await enrichRedemption(updated, user.role === "admin")));
});

export default router;
