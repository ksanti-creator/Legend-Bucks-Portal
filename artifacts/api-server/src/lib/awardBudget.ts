import { db, transactionsTable } from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";

/** UTC calendar year number for a given instant (defaults to now). */
export function currentYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/** [start, end) Date boundaries of the current UTC calendar year. */
export function currentYearRange(now: Date = new Date()): [Date, Date] {
  const year = now.getUTCFullYear();
  return [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1))];
}

/** Anything with a Drizzle `.select()` — the base db or a transaction. */
type Executor = Pick<typeof db, "select">;

/**
 * Total bucks a user has awarded (type 'award') so far this UTC calendar year.
 * This is what a manager/admin's yearly award budget draws down against. Pass a
 * transaction as the executor to read it inside an atomic budget check.
 */
export async function getAwardedThisYear(employeeId: number, executor: Executor = db): Promise<number> {
  const [start, end] = currentYearRange();
  const rows = await executor
    .select({ total: sql<string>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "award"),
        eq(transactionsTable.fromEmployeeId, employeeId),
        gte(transactionsTable.createdAt, start),
        lt(transactionsTable.createdAt, end),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}
