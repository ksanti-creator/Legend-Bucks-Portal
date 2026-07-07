import { Router } from "express";
import type { IRouter } from "express";
import { db, departmentsTable, teamBudgetsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  ListTeamBudgetsResponse,
  GetTeamBudgetParams,
  GetTeamBudgetResponse,
  SetTeamBudgetParams,
  SetTeamBudgetBody,
  SetTeamBudgetResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { currentYear, getTeamBudgetStatus } from "../lib/teamBudget";

const router: IRouter = Router();

// Admin only: list every department's current-year pool with used/remaining.
router.get("/team-budgets", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const departments = await db.select().from(departmentsTable).orderBy(departmentsTable.name);
  const items = await Promise.all(
    departments.map(async (d) => {
      const status = await getTeamBudgetStatus(d.id);
      return { departmentId: d.id, departmentName: d.name, ...status };
    }),
  );

  res.json(ListTeamBudgetsResponse.parse(items));
});

// Admins, or a manager of this department, may view its current-year pool.
router.get("/team-budgets/:departmentId", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const params = GetTeamBudgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [dept] = await db
    .select()
    .from(departmentsTable)
    .where(eq(departmentsTable.id, params.data.departmentId))
    .limit(1);
  if (!dept) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const isDeptManager = user.role === "manager" && user.departmentId === dept.id;
  if (user.role !== "admin" && !isDeptManager) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const status = await getTeamBudgetStatus(dept.id);
  res.json(GetTeamBudgetResponse.parse({ departmentId: dept.id, departmentName: dept.name, ...status }));
});

// Admin only: set (upsert) a department's pool for the current year.
router.put("/team-budgets/:departmentId", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = SetTeamBudgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SetTeamBudgetBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [dept] = await db
    .select()
    .from(departmentsTable)
    .where(eq(departmentsTable.id, params.data.departmentId))
    .limit(1);
  if (!dept) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const year = currentYear();
  const [existing] = await db
    .select()
    .from(teamBudgetsTable)
    .where(and(eq(teamBudgetsTable.departmentId, dept.id), eq(teamBudgetsTable.year, year)))
    .limit(1);

  if (existing) {
    await db
      .update(teamBudgetsTable)
      .set({ amount: body.data.amount })
      .where(eq(teamBudgetsTable.id, existing.id));
  } else {
    await db.insert(teamBudgetsTable).values({ departmentId: dept.id, year, amount: body.data.amount });
  }

  const status = await getTeamBudgetStatus(dept.id);
  res.json(SetTeamBudgetResponse.parse({ departmentId: dept.id, departmentName: dept.name, ...status }));
});

export default router;
