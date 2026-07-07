import { db, transactionsTable, goalsTable, teamBudgetsTable } from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { currentYearRange } from "./awardCap";

// The subset of the drizzle client shared by `db` and a transaction handle, so
// helpers can run either standalone or inside an award transaction (row-locked).
type Executor = Pick<typeof db, "select">;

/**
 * Team (department) budget pool helpers.
 *
 * Each department may have a yearly pool of bucks that its managers award toward
 * that department's team goals. "Used" is derived from the ledger — the sum of
 * `team_goal_award` transactions attached to goals belonging to the department
 * within the current calendar year — never stored, so it can't drift from the
 * source of truth.
 *
 * Caveat: usage is attributed via the goal's *current* departmentId. Moving a
 * goal to another department retroactively shifts its historical usage between
 * the two pools. Team goals are not expected to change departments, so this is
 * acceptable.
 */

export function currentYear(now = new Date()): number {
  return now.getUTCFullYear();
}

/** Total bucks awarded from a department's pool so far this calendar year. */
export async function getUsedThisYear(departmentId: number, executor: Executor = db): Promise<number> {
  const [start, end] = currentYearRange();
  const rows = await executor
    .select({ total: sql<string>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
    .from(transactionsTable)
    .innerJoin(goalsTable, eq(transactionsTable.goalId, goalsTable.id))
    .where(
      and(
        eq(transactionsTable.type, "team_goal_award"),
        eq(goalsTable.departmentId, departmentId),
        gte(transactionsTable.createdAt, start),
        lt(transactionsTable.createdAt, end),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

/** The pool amount set for a department this year (0 when none is set). */
export async function getBudgetAmountThisYear(departmentId: number): Promise<number> {
  const [row] = await db
    .select()
    .from(teamBudgetsTable)
    .where(and(eq(teamBudgetsTable.departmentId, departmentId), eq(teamBudgetsTable.year, currentYear())))
    .limit(1);
  return row?.amount ?? 0;
}

/** Amount, used, and remaining for a department's current-year pool. */
export async function getTeamBudgetStatus(
  departmentId: number,
): Promise<{ year: number; amount: number; used: number; remaining: number }> {
  const [amount, used] = await Promise.all([
    getBudgetAmountThisYear(departmentId),
    getUsedThisYear(departmentId),
  ]);
  return { year: currentYear(), amount, used, remaining: Math.max(0, amount - used) };
}
