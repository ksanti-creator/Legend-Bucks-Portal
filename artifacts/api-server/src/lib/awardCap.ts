import { db, transactionsTable } from "@workspace/db";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getManagerChain } from "./orgChain";

/**
 * Per-employee yearly award cap helpers.
 *
 * An employee may carry an optional `awardCapYearly` limit. It caps how many
 * bucks the recipient's *whole management chain* (their direct manager, that
 * manager's manager, and so on) may award that employee within the current
 * calendar year. Admins are never limited. Because the cap is shared across the
 * chain, a senior manager can't sidestep it by routing awards through a
 * different manager beneath them. The cap is private to admins and to any
 * manager in the recipient's chain — never to the employee or to unrelated
 * managers.
 */

// Half-open [start, end) range covering the current calendar year, in UTC so
// the boundary is deterministic regardless of server timezone (createdAt is
// stored as timestamptz).
export function currentYearRange(now = new Date()): [Date, Date] {
  const year = now.getUTCFullYear();
  return [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1))];
}

/**
 * Total bucks awarded to `employeeId` this calendar year by everyone in their
 * management chain (counts only `award` transactions). This is the figure the
 * shared cap is measured against, so enforcement and the cap-info endpoint stay
 * in lockstep. Returns 0 when the employee has no managers above them.
 */
export async function getChainAwardedThisYear(
  employeeId: number,
  // Callers that already resolved the recipient's chain can pass it to avoid a
  // second full org-tree read on the same request.
  precomputedChain?: number[],
): Promise<number> {
  const chain = precomputedChain ?? (await getManagerChain(employeeId));
  if (chain.length === 0) return 0;
  const [start, end] = currentYearRange();
  const rows = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "award"),
        inArray(transactionsTable.fromEmployeeId, chain),
        eq(transactionsTable.toEmployeeId, employeeId),
        gte(transactionsTable.createdAt, start),
        lt(transactionsTable.createdAt, end),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}
