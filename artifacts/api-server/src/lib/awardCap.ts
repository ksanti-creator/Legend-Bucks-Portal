import { db, transactionsTable } from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";

/**
 * Per-employee yearly award cap helpers.
 *
 * An employee may carry an optional `awardCapYearly` limit. It caps how many
 * bucks a manager may award *that specific employee* within the current
 * calendar year. Admins are never limited. The cap is private to the employee's
 * assigned manager and to admins — it is never exposed to the employee or to
 * unrelated managers.
 */

// Half-open [start, end) range covering the current calendar year, in UTC so
// the boundary is deterministic regardless of server timezone (createdAt is
// stored as timestamptz).
export function currentYearRange(now = new Date()): [Date, Date] {
  const year = now.getUTCFullYear();
  return [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1))];
}

/**
 * Total bucks awarded from `managerId` to `employeeId` so far this calendar
 * year (counts only `award` transactions).
 */
export async function getAwardedThisYear(
  managerId: number,
  employeeId: number,
): Promise<number> {
  const [start, end] = currentYearRange();
  const rows = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "award"),
        eq(transactionsTable.fromEmployeeId, managerId),
        eq(transactionsTable.toEmployeeId, employeeId),
        gte(transactionsTable.createdAt, start),
        lt(transactionsTable.createdAt, end),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}
