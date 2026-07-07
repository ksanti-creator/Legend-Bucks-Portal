import { Router } from "express";
import type { IRouter } from "express";
import { db, budgetsTable, employeesTable, transactionsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  ListBudgetsQueryParams,
  ListBudgetsResponse,
  AssignBudgetBody,
  AssignBudgetResponse,
  GetBudgetParams,
  GetBudgetResponse,
  GetMyBudgetRemainingResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { sendBudgetAssignedEmail } from "../lib/email";

const router: IRouter = Router();

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getUsedAmount(managerId: number, month: string): Promise<number> {
  // Sum awards sent by this manager this month
  const [from, to] = monthToRange(month);
  const result = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
     WHERE type = 'award' AND from_employee_id = ${managerId}
       AND created_at >= '${from}' AND created_at < '${to}'`
  );
  return parseInt(result.rows[0]?.total ?? "0", 10);
}

function monthToRange(month: string): [string, string] {
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(year, mon - 1, 1);
  const end = new Date(year, mon, 1);
  return [start.toISOString(), end.toISOString()];
}

async function buildBudgetResponse(budget: any) {
  const [manager] = await db.select().from(employeesTable).where(eq(employeesTable.id, budget.managerId)).limit(1);
  const usedAmount = await getUsedAmount(budget.managerId, budget.month);
  return {
    id: budget.id,
    managerId: budget.managerId,
    managerName: manager ? `${manager.firstName} ${manager.lastName}` : "Unknown",
    month: budget.month,
    totalAmount: budget.totalAmount,
    usedAmount,
    remainingAmount: Math.max(0, budget.totalAmount - usedAmount),
    createdAt: budget.createdAt.toISOString(),
  };
}

router.get("/budgets", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = ListBudgetsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let budgets = await db.select().from(budgetsTable).orderBy(budgetsTable.month);

  if (user.role === "manager") {
    budgets = budgets.filter((b) => b.managerId === user.id);
  }

  if (params.data.managerId !== undefined) {
    budgets = budgets.filter((b) => b.managerId === params.data.managerId);
  }
  if (params.data.month) {
    budgets = budgets.filter((b) => b.month === params.data.month);
  }

  const result = await Promise.all(budgets.map(buildBudgetResponse));
  res.json(ListBudgetsResponse.parse(result));
});

router.post("/budgets", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = AssignBudgetBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Upsert: if budget for this manager+month already exists, update it
  const existing = await db
    .select()
    .from(budgetsTable)
    .where(and(eq(budgetsTable.managerId, body.data.managerId), eq(budgetsTable.month, body.data.month)))
    .limit(1);

  let budget;
  if (existing.length > 0) {
    const [updated] = await db
      .update(budgetsTable)
      .set({ totalAmount: body.data.totalAmount })
      .where(eq(budgetsTable.id, existing[0].id))
      .returning();
    budget = updated;
  } else {
    const [inserted] = await db
      .insert(budgetsTable)
      .values({
        managerId: body.data.managerId,
        month: body.data.month,
        totalAmount: body.data.totalAmount,
      })
      .returning();
    budget = inserted;
  }

  // Notify the manager by email — best-effort, never blocks the assignment
  // (the lookup is inside the try so no email-related step can fail the route).
  try {
    const [manager] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, budget.managerId))
      .limit(1);
    if (manager?.email) {
      await sendBudgetAssignedEmail(manager.email, manager.firstName, budget.totalAmount, budget.month);
      req.log.info({ managerId: budget.managerId }, "Budget-assigned email sent");
    }
  } catch (err) {
    req.log.error({ err, managerId: budget.managerId }, "Failed to send budget-assigned email");
  }

  res.status(201).json(AssignBudgetResponse.parse(await buildBudgetResponse(budget)));
});

router.get("/budgets/remaining", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "manager" && user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const month = currentMonth();
  const [budget] = await db
    .select()
    .from(budgetsTable)
    .where(and(eq(budgetsTable.managerId, user.id), eq(budgetsTable.month, month)))
    .limit(1);

  const totalAmount = budget?.totalAmount ?? 0;
  const usedAmount = await getUsedAmount(user.id, month);
  const remainingAmount = Math.max(0, totalAmount - usedAmount);

  res.json(
    GetMyBudgetRemainingResponse.parse({
      managerId: user.id,
      month,
      totalAmount,
      usedAmount,
      remainingAmount,
    }),
  );
});

router.get("/budgets/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetBudgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [budget] = await db
    .select()
    .from(budgetsTable)
    .where(eq(budgetsTable.id, params.data.id))
    .limit(1);

  if (!budget) {
    res.status(404).json({ error: "Budget not found" });
    return;
  }

  res.json(GetBudgetResponse.parse(await buildBudgetResponse(budget)));
});

export default router;
