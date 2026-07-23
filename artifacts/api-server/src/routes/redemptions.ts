import { Router } from "express";
import type { IRouter } from "express";
import { db, redemptionsTable, rewardsTable, rewardSizesTable, employeesTable, transactionsTable } from "@workspace/db";
import { eq, and, or, isNull, gt, sql } from "drizzle-orm";
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
import { requireAuth, getCurrentUser, getEmployeeBalance, canViewAccounting, canSpendBucks, canDecideRedemptionFor } from "../lib/auth";
import { getSubtreeIds, getManagerChain } from "../lib/orgChain";
import {
  sendRedemptionReceiptEmail,
  sendNewRedemptionRequestEmail,
  sendRedemptionApprovedEmail,
  sendRedemptionRejectedEmail,
  sendRedemptionFulfilledEmail,
} from "../lib/email";

const router: IRouter = Router();

// Restore stock when a redemption is rejected/cancelled: per-size stock for
// sized redemptions, pooled quantity otherwise. Unlimited stock is untouched.
async function restoreStock(redemption: { rewardId: number; sizeLabel: string | null }) {
  if (redemption.sizeLabel) {
    await db
      .update(rewardSizesTable)
      .set({ quantity: sql`quantity + 1` })
      .where(
        and(
          eq(rewardSizesTable.rewardId, redemption.rewardId),
          eq(rewardSizesTable.label, redemption.sizeLabel),
          sql`quantity IS NOT NULL`,
        ),
      );
    return;
  }
  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, redemption.rewardId)).limit(1);
  if (reward && reward.quantity !== null) {
    await db.update(rewardsTable).set({ quantity: reward.quantity + 1 }).where(eq(rewardsTable.id, reward.id));
  }
}

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
    sizeLabel: r.sizeLabel ?? null,
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

  // Team members only see their own. Managers see their own plus their
  // reporting subtree (their approval queue). Admins/accounting see all.
  if (user.role === "team_member") {
    all = all.filter((r) => r.employeeId === user.id);
  } else if (user.role === "manager") {
    const subtree = new Set(await getSubtreeIds(user.id));
    all = all.filter((r) => r.employeeId === user.id || subtree.has(r.employeeId));
    if (params.data.employeeId !== undefined) {
      all = all.filter((r) => r.employeeId === params.data.employeeId);
    }
  } else if (params.data.employeeId !== undefined) {
    all = all.filter((r) => r.employeeId === params.data.employeeId);
  }

  if (params.data.status) all = all.filter((r) => r.status === params.data.status);
  if (params.data.pendingApproval) all = all.filter((r) => r.status === "requested");

  const enriched = await Promise.all(all.map((r) => enrichRedemption(r, canViewAccounting(user.role))));
  res.json(ListRedemptionsResponse.parse(enriched));
});

router.post("/redemptions", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  // Redeeming spends the employee's own bucks (a ledger write). Only roles on
  // the spend allow-list may do it; read-only roles like accounting_admin can't.
  if (!canSpendBucks(user.role)) {
    res.status(403).json({ error: "You are not allowed to redeem rewards" });
    return;
  }
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

  // Sized rewards ignore the pooled quantity entirely — reward_sizes is the
  // source of truth for their stock.
  const sizes = await db
    .select()
    .from(rewardSizesTable)
    .where(eq(rewardSizesTable.rewardId, reward.id));
  const isSized = sizes.length > 0;

  if (!isSized && reward.quantity !== null && reward.quantity <= 0) {
    res.status(400).json({ error: "Reward is out of stock" });
    return;
  }
  const chosenSize = body.data.sizeLabel ?? null;
  if (isSized) {
    if (!chosenSize) {
      res.status(400).json({ error: "Please pick a size for this reward" });
      return;
    }
    if (!sizes.some((s) => s.label === chosenSize)) {
      res.status(400).json({ error: "Invalid size for this reward" });
      return;
    }
  } else if (chosenSize) {
    res.status(400).json({ error: "This reward does not have sizes" });
    return;
  }

  const balance = await getEmployeeBalance(user.id);
  if (balance < reward.buckCost) {
    res.status(400).json({ error: `Insufficient balance. You have ${balance} bucks, reward costs ${reward.buckCost}` });
    return;
  }

  // Atomically decrement the chosen size's stock (no-op condition-wise for
  // unlimited sizes). If no row comes back, the size just sold out — reject
  // before any bucks move.
  if (isSized && chosenSize) {
    const decremented = await db
      .update(rewardSizesTable)
      .set({ quantity: sql`CASE WHEN quantity IS NULL THEN NULL ELSE quantity - 1 END` })
      .where(
        and(
          eq(rewardSizesTable.rewardId, reward.id),
          eq(rewardSizesTable.label, chosenSize),
          or(isNull(rewardSizesTable.quantity), gt(rewardSizesTable.quantity, 0)),
        ),
      )
      .returning();
    if (decremented.length === 0) {
      res.status(400).json({ error: `Size ${chosenSize} is out of stock` });
      return;
    }
  }

  // Deduct bucks immediately via ledger
  await db.insert(transactionsTable).values({
    type: "redemption_debit",
    amount: reward.buckCost,
    fromEmployeeId: user.id,
    toEmployeeId: null,
    note: `Redemption: ${reward.name}${isSized && chosenSize ? ` (Size ${chosenSize})` : ""}`,
  });

  // Decrement pooled quantity if limited (non-sized rewards only; sized
  // rewards track stock per size instead).
  if (!isSized && reward.quantity !== null) {
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
      sizeLabel: isSized ? chosenSize : null,
      note: body.data.note ?? null,
    })
    .returning();

  // Update transaction with redemption id
  // Postgres doesn't allow ORDER BY/LIMIT directly on UPDATE — target the
  // single newest unlinked debit via a subquery instead.
  await db.execute(sql`
    UPDATE transactions SET redemption_id = ${redemption.id}
    WHERE id = (
      SELECT id FROM transactions
      WHERE type = 'redemption_debit' AND from_employee_id = ${user.id} AND redemption_id IS NULL
      ORDER BY created_at DESC LIMIT 1
    )`);

  // Email the employee a redemption receipt — best-effort, never blocks.
  if (user.email && user.notifyRedemptionUpdates) {
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

  // Notify approvers (all admins + managers in the redeemer's chain) — buck
  // cost only, never CAD. Best-effort per recipient: failures are logged and
  // never block or fail the redemption.
  try {
    const [managerChainIds, allEmployees] = await Promise.all([
      getManagerChain(user.id),
      db.select().from(employeesTable),
    ]);
    const chainSet = new Set(managerChainIds);
    const approvers = allEmployees.filter(
      (e) =>
        e.id !== user.id &&
        e.status === "active" &&
        !!e.email &&
        e.notifyNewRedemptionRequests &&
        (e.role === "admin" || (e.role === "manager" && chainSet.has(e.id))),
    );
    const employeeName = `${user.firstName} ${user.lastName}`;
    for (const approver of approvers) {
      try {
        await sendNewRedemptionRequestEmail(
          approver.email,
          approver.firstName,
          employeeName,
          reward.name,
          redemption.buckCost,
          redemption.note,
          redemption.sizeLabel,
        );
        req.log.info({ redemptionId: redemption.id, approverId: approver.id }, "New redemption request email sent");
      } catch (err) {
        req.log.error({ err, redemptionId: redemption.id, approverId: approver.id }, "Failed to send new redemption request email");
      }
    }
  } catch (err) {
    req.log.error({ err, redemptionId: redemption.id }, "Failed to notify approvers of new redemption");
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
  // Mirror the list scoping: team members only their own; managers only their
  // own or their reporting subtree's; admins/accounting see any.
  if (user.role === "team_member" && redemption.employeeId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (
    user.role === "manager" &&
    redemption.employeeId !== user.id &&
    !(await getSubtreeIds(user.id)).includes(redemption.employeeId)
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json(GetRedemptionResponse.parse(await enrichRedemption(redemption, canViewAccounting(user.role))));
});

router.patch("/redemptions/:id/approve", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);

  const params = ApproveRedemptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [redemption] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, params.data.id)).limit(1);
  if (!redemption) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Admins may decide any redemption; managers only those from their own reports.
  if (!(await canDecideRedemptionFor(user, redemption.employeeId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (redemption.status !== "requested") {
    res.status(400).json({ error: "Redemption cannot be approved" });
    return;
  }

  const [updated] = await db
    .update(redemptionsTable)
    .set({ status: "approved" })
    .where(eq(redemptionsTable.id, params.data.id))
    .returning();

  // Notify the employee their redemption was approved — best-effort, never blocks.
  try {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId)).limit(1);
    const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, updated.rewardId)).limit(1);
    if (emp?.email && emp.notifyRedemptionUpdates) {
      await sendRedemptionApprovedEmail(emp.email, emp.firstName, reward?.name ?? "your reward");
      req.log.info({ redemptionId: updated.id }, "Redemption approved email sent");
    }
  } catch (err) {
    req.log.error({ err, redemptionId: updated.id }, "Failed to send redemption approved email");
  }

  res.json(ApproveRedemptionResponse.parse(await enrichRedemption(updated, canViewAccounting(user.role))));
});

router.patch("/redemptions/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);

  const params = RejectRedemptionParams.safeParse(req.params);
  const body = RejectRedemptionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [redemption] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, params.data.id)).limit(1);
  if (!redemption) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Admins may decide any redemption; managers only those from their own reports.
  if (!(await canDecideRedemptionFor(user, redemption.employeeId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!["requested", "approved"].includes(redemption.status)) {
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

  // Restore stock (per-size for sized redemptions, pooled otherwise)
  await restoreStock(redemption);
  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, redemption.rewardId)).limit(1);

  // Notify the employee their redemption was rejected (and refunded) — best-effort, never blocks.
  try {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId)).limit(1);
    if (emp?.email && emp.notifyRedemptionUpdates) {
      await sendRedemptionRejectedEmail(emp.email, emp.firstName, reward?.name ?? "your reward", updated.buckCost, updated.adminNote);
      req.log.info({ redemptionId: updated.id }, "Redemption rejected email sent");
    }
  } catch (err) {
    req.log.error({ err, redemptionId: updated.id }, "Failed to send redemption rejected email");
  }

  res.json(RejectRedemptionResponse.parse(await enrichRedemption(updated, canViewAccounting(user.role))));
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

  // Cancelling refunds bucks (a ledger write). An admin can cancel anyone's;
  // otherwise only the owner may cancel their own — and only if their role is on
  // the spend allow-list, so read-only roles (accounting_admin) never can, even
  // for a redemption somehow attributed to them. Managers can't cancel others'.
  const isAdmin = user.role === "admin";
  const isSelf = redemption.employeeId === user.id && canSpendBucks(user.role);
  if (!isAdmin && !isSelf) {
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

  // Restore stock (per-size for sized redemptions, pooled otherwise)
  await restoreStock(redemption);

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

  // Notify the employee their reward is on its way — best-effort, never blocks.
  try {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId)).limit(1);
    const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, updated.rewardId)).limit(1);
    if (emp?.email && emp.notifyRedemptionUpdates) {
      await sendRedemptionFulfilledEmail(emp.email, emp.firstName, reward?.name ?? "your reward");
      req.log.info({ redemptionId: updated.id }, "Redemption fulfilled email sent");
    }
  } catch (err) {
    req.log.error({ err, redemptionId: updated.id }, "Failed to send redemption fulfilled email");
  }

  res.json(FulfillRedemptionResponse.parse(await enrichRedemption(updated, user.role === "admin")));
});

export default router;
