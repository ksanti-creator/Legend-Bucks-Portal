import { Router } from "express";
import type { IRouter } from "express";
import { db, employeesTable, transactionsTable, redemptionsTable, goalsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  GetRecentActivityQueryParams,
  GetRecentActivityResponse,
  GetLeaderboardQueryParams,
  GetLeaderboardResponse,
  GetDashboardSummaryResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser } from "../lib/auth";

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

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const employees = await db.select().from(employeesTable);
  const totalEmployees = employees.length;
  const activeEmployees = employees.filter((e) => e.status === "active").length;

  const [totalBucksRow] = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'award'`
  ) as any;

  const month = currentMonth();
  const [from, to] = monthToRange(month);
  const [monthBucksRow] = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'award' AND created_at >= '${from}' AND created_at < '${to}'`
  ) as any;

  const redemptions = await db.select().from(redemptionsTable);
  const totalRedemptions = redemptions.length;
  const pendingApprovals = redemptions.filter((r) => r.status === "requested").length;

  const goals = await db.select().from(goalsTable);
  const activeGoals = goals.filter((g) => g.active).length;

  // Top department by bucks received
  const deptResult = await db.execute<{ department: string; total: string }>(
    `SELECT e.department, COALESCE(SUM(t.amount), 0) AS total
     FROM transactions t
     JOIN employees e ON e.id = t.to_employee_id
     WHERE t.type = 'award' AND e.department IS NOT NULL
     GROUP BY e.department
     ORDER BY total DESC
     LIMIT 1`
  ) as any;

  const topDepartment = deptResult[0]?.department ?? null;

  res.json(
    GetDashboardSummaryResponse.parse({
      totalEmployees,
      activeEmployees,
      totalBucksAwarded: parseInt(totalBucksRow?.total ?? "0", 10),
      thisMonthBucksAwarded: parseInt(monthBucksRow?.total ?? "0", 10),
      totalRedemptions,
      pendingApprovals,
      activeGoals,
      topDepartment,
    }),
  );
});

router.get("/dashboard/activity", requireAuth, async (req, res): Promise<void> => {
  const params = GetRecentActivityQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? 20;
  const user = getCurrentUser(req);

  // Collect from transactions (awards + contributions)
  const txRows = await db
    .select()
    .from(transactionsTable)
    .orderBy(desc(transactionsTable.createdAt))
    .limit(50);

  const items: any[] = [];

  for (const tx of txRows) {
    if (tx.type === "award") {
      let fromName: string | null = null;
      let toName: string | null = null;
      if (tx.fromEmployeeId) {
        const [e] = await db.select().from(employeesTable).where(eq(employeesTable.id, tx.fromEmployeeId)).limit(1);
        if (e) fromName = `${e.firstName} ${e.lastName}`;
      }
      if (tx.toEmployeeId) {
        const [e] = await db.select().from(employeesTable).where(eq(employeesTable.id, tx.toEmployeeId)).limit(1);
        if (e) toName = `${e.firstName} ${e.lastName}`;
      }
      items.push({
        id: tx.id,
        type: "award",
        description: `${fromName ?? "Someone"} sent ${tx.amount} bucks to ${toName ?? "someone"}`,
        actorName: fromName,
        targetName: toName,
        amount: tx.amount,
        createdAt: tx.createdAt.toISOString(),
      });
    } else if (tx.type === "contribution") {
      let fromName: string | null = null;
      if (tx.fromEmployeeId) {
        const [e] = await db.select().from(employeesTable).where(eq(employeesTable.id, tx.fromEmployeeId)).limit(1);
        if (e) fromName = `${e.firstName} ${e.lastName}`;
      }
      items.push({
        id: tx.id + 10000,
        type: "goal_contribution",
        description: `${fromName ?? "Someone"} contributed ${tx.amount} bucks to a team goal`,
        actorName: fromName,
        targetName: null,
        amount: tx.amount,
        createdAt: tx.createdAt.toISOString(),
      });
    }
  }

  // Add recent redemptions
  const redemps = await db
    .select()
    .from(redemptionsTable)
    .orderBy(desc(redemptionsTable.createdAt))
    .limit(10);

  for (const r of redemps) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, r.employeeId)).limit(1);
    items.push({
      id: r.id + 20000,
      type: "redemption",
      description: `${emp ? `${emp.firstName} ${emp.lastName}` : "Someone"} redeemed a reward (${r.buckCost} bucks)`,
      actorName: emp ? `${emp.firstName} ${emp.lastName}` : null,
      targetName: null,
      amount: r.buckCost,
      createdAt: r.createdAt.toISOString(),
    });
  }

  // Sort and limit
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const result = items.slice(0, limit);

  res.json(GetRecentActivityResponse.parse(result));
});

router.get("/dashboard/leaderboard", requireAuth, async (req, res): Promise<void> => {
  const params = GetLeaderboardQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? 10;
  const month = params.data.month ?? currentMonth();
  const [from, to] = monthToRange(month);

  const rows = await db.execute<{ employee_id: number; total: string }>(
    `SELECT to_employee_id AS employee_id, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type = 'award' AND to_employee_id IS NOT NULL
       AND created_at >= '${from}' AND created_at < '${to}'
     GROUP BY to_employee_id
     ORDER BY total DESC
     LIMIT ${limit}`
  ) as any;

  const entries = await Promise.all(
    rows.map(async (row: any, idx: number) => {
      const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, row.employee_id)).limit(1);
      return {
        rank: idx + 1,
        employeeId: row.employee_id,
        employeeName: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
        department: emp?.department ?? null,
        bucksReceived: parseInt(row.total, 10),
      };
    }),
  );

  res.json(GetLeaderboardResponse.parse(entries));
});

export default router;
