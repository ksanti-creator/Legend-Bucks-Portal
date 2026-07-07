import { Router } from "express";
import type { IRouter } from "express";
import { db, goalsTable, goalContributionsTable, employeesTable, transactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListGoalsQueryParams,
  ListGoalsResponse,
  CreateGoalBody,
  CreateGoalResponse,
  GetGoalParams,
  GetGoalResponse,
  UpdateGoalParams,
  UpdateGoalBody,
  UpdateGoalResponse,
  ContributeToGoalParams,
  ContributeToGoalBody,
  ContributeToGoalResponse,
  ListGoalContributionsParams,
  ListGoalContributionsResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser, getEmployeeBalance } from "../lib/auth";

const router: IRouter = Router();

function goalToResponse(g: any) {
  const progressPercent = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    department: g.department,
    targetAmount: g.targetAmount,
    currentAmount: g.currentAmount,
    progressPercent,
    active: g.active,
    endsAt: g.endsAt ? g.endsAt.toISOString() : null,
    createdAt: g.createdAt.toISOString(),
  };
}

router.get("/goals", requireAuth, async (req, res): Promise<void> => {
  const params = ListGoalsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let goals = await db.select().from(goalsTable).orderBy(goalsTable.createdAt);

  if (params.data.department) goals = goals.filter((g) => g.department === params.data.department);
  if (params.data.active !== undefined) goals = goals.filter((g) => g.active === params.data.active);

  res.json(ListGoalsResponse.parse(goals.map(goalToResponse)));
});

router.post("/goals", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = CreateGoalBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [goal] = await db
    .insert(goalsTable)
    .values({
      name: body.data.name,
      description: body.data.description ?? null,
      department: body.data.department ?? null,
      targetAmount: body.data.targetAmount,
      active: body.data.active ?? true,
      endsAt: body.data.endsAt ? new Date(body.data.endsAt) : null,
    })
    .returning();

  res.status(201).json(CreateGoalResponse.parse(goalToResponse(goal)));
});

router.get("/goals/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.id, params.data.id)).limit(1);
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }

  res.json(GetGoalResponse.parse(goalToResponse(goal)));
});

router.patch("/goals/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = UpdateGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateGoalBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updates: Record<string, any> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if ("description" in body.data) updates.description = body.data.description;
  if ("department" in body.data) updates.department = body.data.department;
  if (body.data.targetAmount !== undefined) updates.targetAmount = body.data.targetAmount;
  if (body.data.active !== undefined) updates.active = body.data.active;
  if ("endsAt" in body.data) updates.endsAt = body.data.endsAt ? new Date(body.data.endsAt) : null;

  const [updated] = await db
    .update(goalsTable)
    .set(updates)
    .where(eq(goalsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }

  res.json(UpdateGoalResponse.parse(goalToResponse(updated)));
});

router.post("/goals/:id/contribute", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  // accounting_admin is a read-only finance role and must never move bucks.
  if (user.role === "accounting_admin") {
    res.status(403).json({ error: "Accounting admins cannot contribute to goals" });
    return;
  }
  const params = ContributeToGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = ContributeToGoalBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.id, params.data.id)).limit(1);
  if (!goal || !goal.active) {
    res.status(404).json({ error: "Goal not found or inactive" });
    return;
  }

  const balance = await getEmployeeBalance(user.id);
  if (balance < body.data.amount) {
    res.status(400).json({ error: `Insufficient balance. You have ${balance} bucks.` });
    return;
  }

  // Deduct from employee balance
  await db.insert(transactionsTable).values({
    type: "contribution",
    amount: body.data.amount,
    fromEmployeeId: user.id,
    toEmployeeId: null,
    note: `Contribution to goal: ${goal.name}`,
    goalId: goal.id,
  });

  // Record contribution
  await db.insert(goalContributionsTable).values({
    goalId: goal.id,
    employeeId: user.id,
    amount: body.data.amount,
  });

  // Update goal current amount
  const [updated] = await db
    .update(goalsTable)
    .set({ currentAmount: goal.currentAmount + body.data.amount })
    .where(eq(goalsTable.id, goal.id))
    .returning();

  res.status(201).json(ContributeToGoalResponse.parse(goalToResponse(updated)));
});

router.get("/goals/:id/contributions", requireAuth, async (req, res): Promise<void> => {
  const params = ListGoalContributionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const contributions = await db
    .select()
    .from(goalContributionsTable)
    .where(eq(goalContributionsTable.goalId, params.data.id))
    .orderBy(goalContributionsTable.createdAt);

  const enriched = await Promise.all(
    contributions.map(async (c) => {
      const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, c.employeeId)).limit(1);
      return {
        id: c.id,
        goalId: c.goalId,
        employeeId: c.employeeId,
        employeeName: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
        amount: c.amount,
        createdAt: c.createdAt.toISOString(),
      };
    }),
  );

  res.json(ListGoalContributionsResponse.parse(enriched));
});

export default router;
