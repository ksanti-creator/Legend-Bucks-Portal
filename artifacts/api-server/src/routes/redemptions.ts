import { Router } from "express";
import type { IRouter } from "express";
import { db, redemptionsTable, rewardsTable, rewardSizesTable, employeesTable, transactionsTable, giftCardIssuesTable } from "@workspace/db";
import { eq, and, or, isNull, gt, sql, desc, notInArray } from "drizzle-orm";
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
  IssueGiftCardParams,
  IssueGiftCardResponse,
  ReissueGiftCardParams,
  ReissueGiftCardResponse,
  VoidGiftCardParams,
  VoidGiftCardBody,
  VoidGiftCardResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser, canViewAccounting, canSpendBucks, canDecideRedemptionFor, canPayrollApprove } from "../lib/auth";
import { getSubtreeIds, getManagerChain } from "../lib/orgChain";
import {
  sendRedemptionReceiptEmail,
  sendNewRedemptionRequestEmail,
  sendRedemptionApprovedEmail,
  sendRedemptionRejectedEmail,
  sendRedemptionFulfilledEmail,
  sendPayrollApprovalNeededEmail,
} from "../lib/email";
import { emailGiftCard, generateGiftCardCode, hashGiftCardCode, lbToCadCents, maskGiftCardCode } from "../lib/giftCards";

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

// Time Off rewards affect payroll (PTO balances), so their redemptions need an
// accounting-admin sign-off after the normal approval before fulfillment.
// Identified by the reward's category (case-insensitive to be safe).
function requiresPayrollApproval(reward: { category: string | null } | undefined): boolean {
  return (reward?.category ?? "").trim().toLowerCase() === "time off";
}

// Email every active accounting admin that a redemption is waiting for payroll
// sign-off. Best-effort per recipient; respects the new-redemption-request
// notification preference; never blocks or fails the request.
async function notifyPayrollApprovers(
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  redemption: { id: number; buckCost: number },
  reward: { name: string },
  employeeName: string,
): Promise<void> {
  try {
    const accountants = (await db.select().from(employeesTable)).filter(
      (e) => e.role === "accounting_admin" && e.status === "active" && !!e.email && e.notifyNewRedemptionRequests,
    );
    for (const acct of accountants) {
      try {
        await sendPayrollApprovalNeededEmail(acct.email, acct.firstName, employeeName, reward.name, redemption.buckCost);
        log.info({ redemptionId: redemption.id, accountantId: acct.id }, "Payroll approval needed email sent");
      } catch (err) {
        log.error({ err, redemptionId: redemption.id, accountantId: acct.id }, "Failed to send payroll approval needed email");
      }
    }
  } catch (err) {
    log.error({ err, redemptionId: redemption.id }, "Failed to notify payroll approvers");
  }
}

async function enrichRedemption(r: any, isAdmin: boolean) {
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, r.employeeId)).limit(1);
  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, r.rewardId)).limit(1);
  const [issue] = await db.select().from(giftCardIssuesTable)
    .where(eq(giftCardIssuesTable.redemptionId, r.id))
    .orderBy(desc(giftCardIssuesTable.id)).limit(1);
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
    giftCardLbAmount: r.giftCardLbAmount ?? null,
    giftCardCadValueCents: isAdmin ? (r.giftCardCadValueCents ?? null) : null,
    giftCardRecipientName: r.giftCardRecipientName ?? null,
    giftCardRecipientEmail: r.giftCardRecipientEmail ?? null,
    giftCardMessage: r.giftCardMessage ?? null,
    giftCardIssue: issue ? issueToResponse(issue) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function issueToResponse(issue: typeof giftCardIssuesTable.$inferSelect) {
  return {
    id: issue.id,
    redemptionId: issue.redemptionId,
    maskedCode: maskGiftCardCode(issue.codeLast4),
    status: issue.status,
    issuedAt: issue.issuedAt.toISOString(),
    emailedAt: issue.emailedAt?.toISOString() ?? null,
    voidedAt: issue.voidedAt?.toISOString() ?? null,
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

  const requestedGiftCardAmount = body.data.giftCardLbAmount;
  if (!reward.isCustomGiftCard && requestedGiftCardAmount !== undefined) {
    res.status(400).json({ error: "Custom denomination is not allowed for this reward" });
    return;
  }
  let redemptionCost = reward.buckCost;
  if (reward.isCustomGiftCard) {
    const increment = reward.giftCardIncrementLb ?? 100;
    const minimum = reward.giftCardMinimumLb ?? 100;
    if (
      !Number.isSafeInteger(requestedGiftCardAmount) ||
      requestedGiftCardAmount! <= 0 ||
      requestedGiftCardAmount! < minimum ||
      requestedGiftCardAmount! % increment !== 0 ||
      (reward.giftCardMaximumLb !== null && requestedGiftCardAmount! > reward.giftCardMaximumLb)
    ) {
      res.status(400).json({ error: `Gift card amount must be at least ${minimum} LB and a multiple of ${increment} LB` });
      return;
    }
    if (!body.data.giftCardRecipientName?.trim() || !body.data.giftCardRecipientEmail?.trim()) {
      res.status(400).json({ error: "Recipient name and email are required" });
      return;
    }
    redemptionCost = requestedGiftCardAmount!;
  } else if (
    body.data.giftCardRecipientName !== undefined ||
    body.data.giftCardRecipientEmail !== undefined ||
    body.data.giftCardMessage !== undefined
  ) {
    res.status(400).json({ error: "Gift card recipient details are not allowed for this reward" });
    return;
  }
  // Time Off rewards can never skip payroll sign-off: even when the first
  // approval is not required, they stop at pending_payroll instead of approved.
  const needsPayroll = requiresPayrollApproval(reward);
  const initialStatus = reward.approvalRequired ? "requested" : needsPayroll ? "pending_payroll" : "approved";
  let redemption: typeof redemptionsTable.$inferSelect;
  try {
    redemption = await db.transaction(async (trx) => {
      // Serialize all spends for one employee so two concurrent redemptions
      // cannot both pass a stale balance check.
      await trx.execute(sql`SELECT pg_advisory_xact_lock(${user.id})`);
      const balanceResult = await trx.execute<{ balance: string }>(sql`
        SELECT COALESCE(SUM(CASE
          WHEN type IN ('award','refund') AND to_employee_id = ${user.id} THEN amount
          WHEN type = 'adjustment' AND to_employee_id = ${user.id} THEN amount
          WHEN type IN ('redemption_debit','contribution') AND from_employee_id = ${user.id} THEN -amount
          WHEN type = 'adjustment' AND from_employee_id = ${user.id} THEN -amount
          ELSE 0 END), 0) AS balance FROM transactions`);
      const balance = Number(balanceResult.rows[0]?.balance ?? 0);
      if (balance < redemptionCost) throw new Error(`Insufficient balance. You have ${balance} bucks, reward costs ${redemptionCost}`);

      if (isSized && chosenSize) {
        const decremented = await trx.update(rewardSizesTable)
          .set({ quantity: sql`CASE WHEN quantity IS NULL THEN NULL ELSE quantity - 1 END` })
          .where(and(
            eq(rewardSizesTable.rewardId, reward.id),
            eq(rewardSizesTable.label, chosenSize),
            or(isNull(rewardSizesTable.quantity), gt(rewardSizesTable.quantity, 0)),
          )).returning();
        if (!decremented.length) throw new Error(`Size ${chosenSize} is out of stock`);
      } else if (reward.quantity !== null) {
        const decremented = await trx.update(rewardsTable).set({ quantity: sql`${rewardsTable.quantity} - 1` })
          .where(and(eq(rewardsTable.id, reward.id), gt(rewardsTable.quantity, 0))).returning();
        if (!decremented.length) throw new Error("Reward is out of stock");
      }

      const [created] = await trx.insert(redemptionsTable).values({
      employeeId: user.id,
      rewardId: reward.id,
      status: initialStatus,
      buckCost: redemptionCost,
      cadValueCents: reward.isCustomGiftCard ? lbToCadCents(redemptionCost) : (reward.cadValueCents ?? null),
      sizeLabel: isSized ? chosenSize : null,
      note: body.data.note ?? null,
      giftCardLbAmount: reward.isCustomGiftCard ? redemptionCost : null,
      giftCardCadValueCents: reward.isCustomGiftCard ? lbToCadCents(redemptionCost) : null,
      giftCardRecipientName: reward.isCustomGiftCard ? body.data.giftCardRecipientName!.trim() : null,
      giftCardRecipientEmail: reward.isCustomGiftCard ? body.data.giftCardRecipientEmail!.trim().toLowerCase() : null,
      giftCardMessage: reward.isCustomGiftCard ? (body.data.giftCardMessage?.trim() || null) : null,
      }).returning();
      await trx.insert(transactionsTable).values({
        type: "redemption_debit",
        amount: redemptionCost,
        fromEmployeeId: user.id,
        toEmployeeId: null,
        note: `Redemption: ${reward.name}${isSized && chosenSize ? ` (Size ${chosenSize})` : ""}`,
        redemptionId: created.id,
      });
      return created;
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to redeem reward" });
    return;
  }

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
        reward.isCustomGiftCard && redemption.giftCardRecipientName && redemption.giftCardRecipientEmail
          ? {
              cadValueCents: redemption.giftCardCadValueCents!,
              recipientName: redemption.giftCardRecipientName,
              recipientEmail: redemption.giftCardRecipientEmail,
              message: redemption.giftCardMessage,
            }
          : undefined,
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

  // If it went straight to pending_payroll (Time Off, no first approval),
  // accounting admins need to hear about it now.
  if (redemption.status === "pending_payroll") {
    await notifyPayrollApprovers(req.log, redemption, reward, `${user.firstName} ${user.lastName}`);
  }

  res.status(201).json(CreateRedemptionResponse.parse(await enrichRedemption(redemption, user.role === "admin")));
});

// This is intentionally admin-only, rather than the broader accounting read
// capability: it contains recipient PII alongside the redemption export.
router.get("/redemptions/export", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const all = await db.select().from(redemptionsTable).orderBy(desc(redemptionsTable.createdAt));
  const enriched = await Promise.all(all.map((redemption) => enrichRedemption(redemption, true)));
  const escapeCsv = (value: string | number | null | undefined): string =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = [
    "id", "employeeId", "employeeName", "rewardId", "rewardName", "status",
    "buckCost", "cadValueCents", "cadValueCad", "sizeLabel", "note", "adminNote",
    "giftCardLbAmount", "giftCardCadValueCents", "giftCardCadValueCad",
    "giftCardRecipientName", "giftCardRecipientEmail", "giftCardMessage",
    "giftCardMaskedCode", "giftCardIssueStatus", "giftCardIssuedAt",
    "giftCardEmailedAt", "giftCardVoidedAt", "createdAt", "updatedAt",
  ].join(",");
  const rows = enriched.map((redemption) => [
    redemption.id,
    redemption.employeeId,
    redemption.employeeName,
    redemption.rewardId,
    redemption.rewardName,
    redemption.status,
    redemption.buckCost,
    redemption.cadValueCents,
    redemption.cadValueCents === null ? null : (redemption.cadValueCents / 100).toFixed(2),
    redemption.sizeLabel,
    redemption.note,
    redemption.adminNote,
    redemption.giftCardLbAmount,
    redemption.giftCardCadValueCents,
    redemption.giftCardCadValueCents === null ? null : (redemption.giftCardCadValueCents / 100).toFixed(2),
    redemption.giftCardRecipientName,
    redemption.giftCardRecipientEmail,
    redemption.giftCardMessage,
    redemption.giftCardIssue?.maskedCode,
    redemption.giftCardIssue?.status,
    redemption.giftCardIssue?.issuedAt,
    redemption.giftCardIssue?.emailedAt,
    redemption.giftCardIssue?.voidedAt,
    redemption.createdAt,
    redemption.updatedAt,
  ].map(escapeCsv).join(","));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=redemptions.csv");
  res.send(`${header}\n${rows.join("\n")}`);
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

  // Time Off redemptions don't become approved here — they move to the payroll
  // sign-off queue instead. Everything else approves exactly as before.
  const [reward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, redemption.rewardId)).limit(1);
  const nextStatus = requiresPayrollApproval(reward) ? "pending_payroll" : "approved";

  const [updated] = await db
    .update(redemptionsTable)
    .set({ status: nextStatus })
    .where(eq(redemptionsTable.id, params.data.id))
    .returning();

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId)).limit(1);

  if (nextStatus === "pending_payroll") {
    // Accounting admins take it from here.
    if (reward && emp) {
      await notifyPayrollApprovers(req.log, updated, reward, `${emp.firstName} ${emp.lastName}`);
    }
  } else {
    // Notify the employee their redemption was approved — best-effort, never blocks.
    try {
      if (emp?.email && emp.notifyRedemptionUpdates) {
        await sendRedemptionApprovedEmail(emp.email, emp.firstName, reward?.name ?? "your reward");
        req.log.info({ redemptionId: updated.id }, "Redemption approved email sent");
      }
    } catch (err) {
      req.log.error({ err, redemptionId: updated.id }, "Failed to send redemption approved email");
    }
  }

  res.json(ApproveRedemptionResponse.parse(await enrichRedemption(updated, canViewAccounting(user.role))));
});

// Payroll sign-off: second approval for Time Off redemptions. Positive
// allow-list — only accounting admins and admins; managers (who did the first
// approval) can never action this step.
router.patch("/redemptions/:id/payroll-approve", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (!canPayrollApprove(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = ApproveRedemptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [redemption] = await db.select().from(redemptionsTable).where(eq(redemptionsTable.id, params.data.id)).limit(1);
  if (!redemption) {
    res.status(404).json({ error: "Redemption not found" });
    return;
  }
  if (redemption.status !== "pending_payroll") {
    res.status(400).json({ error: "Redemption is not awaiting payroll sign-off" });
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

// Payroll rejection: refunds bucks and restores stock, exactly like a normal
// rejection. Same allow-list as payroll-approve.
router.patch("/redemptions/:id/payroll-reject", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (!canPayrollApprove(user.role)) {
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
  if (!redemption) {
    res.status(404).json({ error: "Redemption not found" });
    return;
  }
  if (redemption.status !== "pending_payroll") {
    res.status(400).json({ error: "Redemption is not awaiting payroll sign-off" });
    return;
  }

  const [updated] = await db
    .update(redemptionsTable)
    .set({ status: "rejected", adminNote: body.data.adminNote ?? null })
    .where(and(eq(redemptionsTable.id, params.data.id), eq(redemptionsTable.status, "pending_payroll")))
    .returning();
  if (!updated) {
    res.status(400).json({ error: "Redemption is no longer awaiting payroll sign-off" });
    return;
  }

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

  let updated: typeof redemptionsTable.$inferSelect;
  try {
    updated = await db.transaction(async (trx) => {
      // Serialize against Issue & Email/Reissue. An email failure is
      // delivery-ambiguous, so any current card must be explicitly voided
      // before the underlying redemption can be refunded.
      await trx.execute(sql`SELECT pg_advisory_xact_lock(${redemption.id})`);
      const [activeIssue] = await trx
        .select({ id: giftCardIssuesTable.id })
        .from(giftCardIssuesTable)
        .where(
          and(
            eq(giftCardIssuesTable.redemptionId, redemption.id),
            notInArray(giftCardIssuesTable.status, ["voided", "reissued"]),
          ),
        )
        .limit(1);
      if (activeIssue) {
        throw new Error("Void the issued gift card before rejecting and refunding this redemption");
      }

      const [resolved] = await trx
        .update(redemptionsTable)
        .set({ status: "rejected", adminNote: body.data.adminNote ?? null })
        .where(and(eq(redemptionsTable.id, params.data.id), eq(redemptionsTable.status, redemption.status)))
        .returning();
      if (!resolved) throw new Error("Redemption has already been resolved");

      await trx.insert(transactionsTable).values({
        type: "refund",
        amount: redemption.buckCost,
        fromEmployeeId: null,
        toEmployeeId: redemption.employeeId,
        note: `Refund for rejected redemption #${redemption.id}`,
        redemptionId: redemption.id,
      });
      return resolved;
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to reject redemption" });
    return;
  }

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
    .where(and(eq(redemptionsTable.id, params.data.id), eq(redemptionsTable.status, "requested")))
    .returning();
  if (!updated) {
    res.status(400).json({ error: "Redemption has already been resolved" });
    return;
  }

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
  const [fulfillReward] = await db.select().from(rewardsTable).where(eq(rewardsTable.id, redemption.rewardId)).limit(1);
  if (fulfillReward?.isCustomGiftCard || redemption.giftCardLbAmount !== null) {
    res.status(400).json({ error: "Use Issue & Email Gift Card for custom gift cards" });
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

async function createIssue(redemptionId: number, adminId: number, isReissue: boolean) {
  const code = generateGiftCardCode();
  const created = await db.transaction(async (trx) => {
    await trx.execute(sql`SELECT pg_advisory_xact_lock(${redemptionId})`);
    const [redemption] = await trx.select().from(redemptionsTable).where(eq(redemptionsTable.id, redemptionId)).limit(1);
    if (!redemption) throw new Error("Redemption not found");
    const [reward] = await trx.select().from(rewardsTable).where(eq(rewardsTable.id, redemption.rewardId)).limit(1);
    const hasCustomGiftCardSnapshot = !!redemption.giftCardLbAmount && !!redemption.giftCardCadValueCents &&
      !!redemption.giftCardRecipientName && !!redemption.giftCardRecipientEmail;
    if (!reward || !hasCustomGiftCardSnapshot || (redemption.status !== "approved" && !(isReissue && redemption.status === "fulfilled"))) {
      throw new Error("Gift cards can only be issued for approved custom gift card redemptions");
    }
    const [current] = await trx.select().from(giftCardIssuesTable)
      .where(eq(giftCardIssuesTable.redemptionId, redemptionId)).orderBy(desc(giftCardIssuesTable.id)).limit(1);
    if (!isReissue && current) throw new Error("A card has already been issued; use Reissue Card");
    if (isReissue && (!current || current.status === "voided" || current.status === "reissued")) {
      throw new Error("There is no active card to reissue");
    }
    if (isReissue && current) {
      await trx.update(giftCardIssuesTable).set({
        status: "reissued", voidedAt: new Date(), voidReason: "Reissued by administrator",
      }).where(eq(giftCardIssuesTable.id, current.id));
    }
    if (!redemption.giftCardRecipientName || !redemption.giftCardRecipientEmail || !redemption.giftCardLbAmount || !redemption.giftCardCadValueCents) {
      throw new Error("Gift card redemption snapshot is incomplete");
    }
    const [issue] = await trx.insert(giftCardIssuesTable).values({
      redemptionId,
      codeHash: hashGiftCardCode(code),
      codeLast4: code.slice(-4),
      recipientName: redemption.giftCardRecipientName,
      recipientEmail: redemption.giftCardRecipientEmail,
      lbAmount: redemption.giftCardLbAmount,
      cadValueCents: redemption.giftCardCadValueCents,
      issuedByEmployeeId: adminId,
    }).returning();
    if (isReissue && current) {
      await trx.update(giftCardIssuesTable).set({ replacementIssueId: issue.id }).where(eq(giftCardIssuesTable.id, current.id));
    }
    return {
      issue,
      catalogImageUrl:
        reward.imageUrls[0] ??
        reward.imageUrl ??
        "/images/legend-bucks-gift-card.png",
    };
  });
  try {
    await emailGiftCard({
      recipientEmail: created.issue.recipientEmail,
      recipientName: created.issue.recipientName,
      code,
      cadValueCents: created.issue.cadValueCents,
      catalogImageUrl: created.catalogImageUrl,
    });
    const [emailed] = await db.transaction(async (trx) => {
      const rows = await trx.update(giftCardIssuesTable).set({ status: "emailed", emailedAt: new Date() })
        .where(and(eq(giftCardIssuesTable.id, created.issue.id), eq(giftCardIssuesTable.status, "pending_issue"))).returning();
      if (rows.length) {
        await trx.update(redemptionsTable).set({ status: "fulfilled" })
          .where(and(eq(redemptionsTable.id, redemptionId), eq(redemptionsTable.status, "approved")));
      }
      return rows;
    });
    return emailed ?? created.issue;
  } catch {
    const [failed] = await db.update(giftCardIssuesTable).set({ status: "email_failed" })
      .where(and(eq(giftCardIssuesTable.id, created.issue.id), eq(giftCardIssuesTable.status, "pending_issue"))).returning();
    return failed ?? created.issue;
  }
}

router.post("/redemptions/:id/gift-card/issue", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = IssueGiftCardParams.safeParse(req.params);
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const issue = await createIssue(params.data.id, user.id, false);
    res.json(IssueGiftCardResponse.parse(issueToResponse(issue)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to issue gift card" });
  }
});

router.post("/redemptions/:id/gift-card/reissue", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = ReissueGiftCardParams.safeParse(req.params);
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const issue = await createIssue(params.data.id, user.id, true);
    res.json(ReissueGiftCardResponse.parse(issueToResponse(issue)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to reissue gift card" });
  }
});

router.post("/redemptions/:id/gift-card/void", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = VoidGiftCardParams.safeParse(req.params);
  const body = VoidGiftCardBody.safeParse(req.body);
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  if (!params.success || !body.success) { res.status(400).json({ error: "A void reason is required" }); return; }
  const [issue] = await db.transaction(async (trx) => {
    await trx.execute(sql`SELECT pg_advisory_xact_lock(${params.data.id})`);
    const [current] = await trx.select().from(giftCardIssuesTable)
      .where(eq(giftCardIssuesTable.redemptionId, params.data.id)).orderBy(desc(giftCardIssuesTable.id)).limit(1);
    if (!current || current.status === "voided" || current.status === "reissued") return [];
    return trx.update(giftCardIssuesTable).set({
      status: "voided", voidedAt: new Date(), voidReason: body.data.reason.trim(),
    }).where(eq(giftCardIssuesTable.id, current.id)).returning();
  });
  if (!issue) { res.status(400).json({ error: "There is no active card to void" }); return; }
  res.json(VoidGiftCardResponse.parse(issueToResponse(issue)));
});

export default router;
