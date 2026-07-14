import { Router } from "express";
import type { IRouter } from "express";
import { db, transactionsTable, employeesTable, redemptionsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import {
  ListTransactionsQueryParams,
  ListTransactionsResponse,
  SendBucksBody,
  SendBucksResponse,
  GetTransactionParams,
  GetTransactionResponse,
  ExportTransactionsQueryParams,
  GetTransactionSummaryQueryParams,
  GetTransactionSummaryResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser, canViewAccounting, canAwardBucks } from "../lib/auth";
import { getAwardedThisYear } from "../lib/awardBudget";
import { getMaxSingleAward } from "../lib/settings";
import { sendBucksReceivedEmail } from "../lib/email";

const router: IRouter = Router();

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthToRange(month: string): [string, string] {
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(year, mon - 1, 1);
  const end = new Date(year, mon, 1);
  return [start.toISOString(), end.toISOString()];
}

async function enrichTransaction(tx: any, isAdmin: boolean) {
  let fromEmployeeName: string | null = null;
  let toEmployeeName: string | null = null;

  if (tx.fromEmployeeId) {
    const [e] = await db.select().from(employeesTable).where(eq(employeesTable.id, tx.fromEmployeeId)).limit(1);
    if (e) fromEmployeeName = `${e.firstName} ${e.lastName}`;
  }
  if (tx.toEmployeeId) {
    const [e] = await db.select().from(employeesTable).where(eq(employeesTable.id, tx.toEmployeeId)).limit(1);
    if (e) toEmployeeName = `${e.firstName} ${e.lastName}`;
  }

  // CAD value is accounting-only: only surface it to admins, and only for
  // redemption rows (via the redemption's snapshotted value).
  let cadValueCents: number | null = null;
  if (isAdmin && tx.redemptionId) {
    const [redemption] = await db
      .select()
      .from(redemptionsTable)
      .where(eq(redemptionsTable.id, tx.redemptionId))
      .limit(1);
    cadValueCents = redemption?.cadValueCents ?? null;
  }

  return {
    id: tx.id,
    type: tx.type,
    amount: tx.amount,
    fromEmployeeId: tx.fromEmployeeId,
    fromEmployeeName,
    toEmployeeId: tx.toEmployeeId,
    toEmployeeName,
    note: tx.note,
    redemptionId: tx.redemptionId,
    cadValueCents,
    goalId: tx.goalId,
    createdAt: tx.createdAt.toISOString(),
  };
}

router.get("/transactions", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = ListTransactionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? 50;
  const offset = params.data.offset ?? 0;

  let all = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.createdAt));

  // Team members can only see their own transactions
  if (user.role === "team_member") {
    all = all.filter((tx) => tx.fromEmployeeId === user.id || tx.toEmployeeId === user.id);
  } else if (params.data.employeeId !== undefined) {
    const eId = params.data.employeeId;
    all = all.filter((tx) => tx.fromEmployeeId === eId || tx.toEmployeeId === eId);
  }

  if (params.data.type) {
    all = all.filter((tx) => tx.type === params.data.type);
  }
  if (params.data.from) {
    const from = new Date(params.data.from);
    all = all.filter((tx) => tx.createdAt >= from);
  }
  if (params.data.to) {
    const to = new Date(params.data.to);
    all = all.filter((tx) => tx.createdAt <= to);
  }

  const total = all.length;
  const page = all.slice(offset, offset + limit);
  const enriched = await Promise.all(page.map((tx) => enrichTransaction(tx, canViewAccounting(user.role))));

  res.json(ListTransactionsResponse.parse({ items: enriched, total, offset, limit }));
});

router.post("/transactions", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  // Only roles on the award allow-list may send bucks (admins + managers).
  // Anyone else — including read-only roles like accounting_admin — is denied.
  if (!canAwardBucks(user.role)) {
    res.status(403).json({ error: "You are not allowed to send bucks" });
    return;
  }

  const body = SendBucksBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { toEmployeeId, amount, note } = body.data;

  // Nobody can award bucks to themselves — enforced server-side so the rule
  // holds regardless of the client (the UI also hides self from the picker).
  if (toEmployeeId === user.id) {
    res.status(400).json({ error: "You can't send bucks to yourself" });
    return;
  }

  // Check recipient exists
  const [recipient] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, toEmployeeId))
    .limit(1);

  if (!recipient || recipient.status === "inactive") {
    res.status(400).json({ error: "Recipient not found or inactive" });
    return;
  }

  // Global maximum single award. When configured, no single award may exceed
  // it — this applies to every awarding role, admins included.
  const maxSingleAward = await getMaxSingleAward();
  if (maxSingleAward != null && amount > maxSingleAward) {
    res.status(400).json({ error: `That exceeds the maximum single award of ${maxSingleAward} bucks.` });
    return;
  }

  // Draw the award down from the sender's own yearly award budget. This runs
  // atomically: we lock the sender's employee row (SELECT ... FOR UPDATE) so two
  // concurrent awards can't both pass the remaining-budget check and overspend
  // the budget. A sender with no budget set (null) cannot award at all.
  const spend = await db.transaction(async (trx) => {
    const [sender] = await trx
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, user.id))
      .for("update")
      .limit(1);

    const budget = sender?.awardBudgetYearly ?? null;
    if (budget == null) return { blocked: "no-budget" as const };

    const used = await getAwardedThisYear(user.id, trx);
    const remaining = budget - used;
    if (amount > remaining) return { blocked: "over-budget" as const, remaining: Math.max(0, remaining) };

    const [created] = await trx
      .insert(transactionsTable)
      .values({
        type: "award",
        amount,
        fromEmployeeId: user.id,
        toEmployeeId,
        note: note ?? null,
      })
      .returning();
    return { tx: created };
  });

  if ("blocked" in spend) {
    if (spend.blocked === "no-budget") {
      res.status(400).json({
        error: "You don't have an award budget set. Ask an admin to set your yearly award budget.",
      });
    } else {
      res.status(400).json({
        error: `This exceeds your remaining award budget for the year (${spend.remaining} bucks left).`,
      });
    }
    return;
  }

  const tx = spend.tx;

  // Notify the recipient by email — best-effort, never blocks the award.
  // Respect the recipient's notification preference.
  if (recipient.email && recipient.notifyBucksReceived) {
    try {
      await sendBucksReceivedEmail(
        recipient.email,
        recipient.firstName,
        `${user.firstName} ${user.lastName}`,
        amount,
        note ?? null,
      );
      req.log.info({ toEmployeeId }, "Bucks-received email sent");
    } catch (err) {
      req.log.error({ err, toEmployeeId }, "Failed to send bucks-received email");
    }
  }

  res.status(201).json(SendBucksResponse.parse(await enrichTransaction(tx, user.role === "admin")));
});

router.get("/transactions/export", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (!canViewAccounting(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = ExportTransactionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let all = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.createdAt));

  if (params.data.from) {
    const from = new Date(params.data.from);
    all = all.filter((tx) => tx.createdAt >= from);
  }
  if (params.data.to) {
    const to = new Date(params.data.to);
    all = all.filter((tx) => tx.createdAt <= to);
  }

  const header = "id,type,amount,fromEmployeeId,toEmployeeId,note,redemptionId,goalId,createdAt\n";
  const rows = all.map((tx) =>
    [
      tx.id,
      tx.type,
      tx.amount,
      tx.fromEmployeeId ?? "",
      tx.toEmployeeId ?? "",
      `"${(tx.note ?? "").replace(/"/g, '""')}"`,
      tx.redemptionId ?? "",
      tx.goalId ?? "",
      tx.createdAt.toISOString(),
    ].join(","),
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=transactions.csv");
  res.send(header + rows.join("\n"));
});

router.get("/transactions/summary", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = GetTransactionSummaryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Team members can only see their own summary; admins/managers can query any employee
  const requestedId = params.data.employeeId;
  if (requestedId !== undefined && user.role === "team_member" && requestedId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const targetId = requestedId ?? user.id;
  const month = params.data.month ?? currentMonth();
  const [from, to] = monthToRange(month);

  const totalSentResult = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'award' AND from_employee_id = ${targetId}`
  );
  const totalReceivedResult = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type IN ('award','refund') AND to_employee_id = ${targetId}`
  );
  const monthSentResult = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'award' AND from_employee_id = ${targetId} AND created_at >= '${from}' AND created_at < '${to}'`
  );
  const monthReceivedResult = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type IN ('award','refund') AND to_employee_id = ${targetId} AND created_at >= '${from}' AND created_at < '${to}'`
  );

  res.json(
    GetTransactionSummaryResponse.parse({
      totalSent: parseInt(totalSentResult.rows[0]?.total ?? "0", 10),
      totalReceived: parseInt(totalReceivedResult.rows[0]?.total ?? "0", 10),
      thisMonthSent: parseInt(monthSentResult.rows[0]?.total ?? "0", 10),
      thisMonthReceived: parseInt(monthReceivedResult.rows[0]?.total ?? "0", 10),
    }),
  );
});

router.get("/transactions/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [tx] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.id, params.data.id))
    .limit(1);

  if (!tx) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }

  const user = getCurrentUser(req);
  if (user.role === "team_member" && tx.fromEmployeeId !== user.id && tx.toEmployeeId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json(GetTransactionResponse.parse(await enrichTransaction(tx, canViewAccounting(user.role))));
});

export default router;
