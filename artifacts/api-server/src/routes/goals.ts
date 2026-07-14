import { Router } from "express";
import type { IRouter } from "express";
import { db, goalsTable, goalContributionsTable, employeesTable, transactionsTable, departmentsTable } from "@workspace/db";
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
import { requireAuth, getCurrentUser, getEmployeeBalance, canSpendBucks } from "../lib/auth";

const router: IRouter = Router();

// Map of department id -> name so goal responses can resolve their linked
// department without a per-goal query.
async function departmentNameMap(): Promise<Map<number, string>> {
  const rows = await db.select().from(departmentsTable);
  return new Map(rows.map((d) => [d.id, d.name]));
}

function goalToResponse(g: any, deptNames?: Map<number, string>) {
  const progressPercent = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
  // Resolve the display name from the real department link when present, else
  // fall back to the legacy free-text label.
  const department =
    g.departmentId != null ? (deptNames?.get(g.departmentId) ?? null) : (g.department ?? null);
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    department,
    departmentId: g.departmentId ?? null,
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
  const deptNames = await departmentNameMap();

  if (params.data.department)
    goals = goals.filter(
      (g) => (g.departmentId != null ? deptNames.get(g.departmentId) : g.department) === params.data.department,
    );
  if (params.data.active !== undefined) goals = goals.filter((g) => g.active === params.data.active);

  res.json(ListGoalsResponse.parse(goals.map((g) => goalToResponse(g, deptNames))));
});

router.post("/goals", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  // Team goals are manager-owned: admins create for any department, managers
  // only for their own. Read-only roles (team_member, accounting_admin) can't.
  if (user.role !== "admin" && user.role !== "manager") {
    res.status(403).json({ error: "You are not allowed to create goals" });
    return;
  }

  const body = CreateGoalBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const deptNames = await departmentNameMap();
  const departmentId = body.data.departmentId;
  if (!deptNames.has(departmentId)) {
    res.status(400).json({ error: "Department not found" });
    return;
  }
  if (user.role === "manager" && user.departmentId !== departmentId) {
    res.status(403).json({ error: "Managers can only create goals for their own department" });
    return;
  }

  const [goal] = await db
    .insert(goalsTable)
    .values({
      name: body.data.name,
      description: body.data.description ?? null,
      departmentId,
      // Keep the legacy text label in sync for display fallback.
      department: deptNames.get(departmentId) ?? null,
      targetAmount: body.data.targetAmount,
      active: body.data.active ?? true,
      endsAt: body.data.endsAt ? new Date(body.data.endsAt) : null,
    })
    .returning();

  res.status(201).json(CreateGoalResponse.parse(goalToResponse(goal, deptNames)));
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

  const deptNames = await departmentNameMap();
  res.json(GetGoalResponse.parse(goalToResponse(goal, deptNames)));
});

router.patch("/goals/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  // Admins update any goal; managers only goals in their own department.
  if (user.role !== "admin" && user.role !== "manager") {
    res.status(403).json({ error: "You are not allowed to update goals" });
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

  const [existing] = await db.select().from(goalsTable).where(eq(goalsTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  if (user.role === "manager" && existing.departmentId !== user.departmentId) {
    res.status(403).json({ error: "Managers can only update goals for their own department" });
    return;
  }

  const deptNames = await departmentNameMap();
  const updates: Record<string, any> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if ("description" in body.data) updates.description = body.data.description;
  if (body.data.departmentId !== undefined) {
    const departmentId = body.data.departmentId;
    if (!deptNames.has(departmentId)) {
      res.status(400).json({ error: "Department not found" });
      return;
    }
    if (user.role === "manager" && departmentId !== user.departmentId) {
      res.status(403).json({ error: "Managers can only assign goals to their own department" });
      return;
    }
    updates.departmentId = departmentId;
    // Keep the legacy text label in sync for display fallback.
    updates.department = deptNames.get(departmentId) ?? null;
  }
  if (body.data.targetAmount !== undefined) updates.targetAmount = body.data.targetAmount;
  if (body.data.active !== undefined) updates.active = body.data.active;
  if ("endsAt" in body.data) updates.endsAt = body.data.endsAt ? new Date(body.data.endsAt) : null;

  const [updated] = await db
    .update(goalsTable)
    .set(updates)
    .where(eq(goalsTable.id, params.data.id))
    .returning();

  res.json(UpdateGoalResponse.parse(goalToResponse(updated, deptNames)));
});

router.post("/goals/:id/contribute", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  // Contributing spends the employee's own bucks (a ledger write). Only roles on
  // the spend allow-list may do it; read-only roles like accounting_admin can't.
  if (!canSpendBucks(user.role)) {
    res.status(403).json({ error: "You are not allowed to contribute bucks" });
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

  const deptNames = await departmentNameMap();
  res.status(201).json(ContributeToGoalResponse.parse(goalToResponse(updated, deptNames)));
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
