import { db, transactionsTable } from "@workspace/db";
import { eq, and, asc, like, or } from "drizzle-orm";

/**
 * The exact note the invite flow writes on the starting-balance adjustment
 * credit. Used to find that entry again when an admin corrects a typo.
 */
export const STARTING_BALANCE_NOTE = "Starting balance – turned in physical bucks";

/** Prefix used for correction entries so they can be recognized later. */
export const STARTING_BALANCE_CORRECTION_PREFIX = "Starting balance correction:";

export interface StartingBalanceInfo {
  hasStartingBalance: boolean;
  originalAmount: number | null;
  effectiveAmount: number | null;
  correctionCount: number;
}

type Dbish = Pick<typeof db, "select">;

/**
 * Find the invite-time starting-balance entry for an employee and net out any
 * corrections already applied. Corrections are adjustment rows whose note
 * starts with the correction prefix: credits raise the effective starting
 * balance, debits lower it.
 */
export async function getStartingBalanceInfo(
  employeeId: number,
  trx: Dbish = db,
): Promise<StartingBalanceInfo> {
  const [original] = await trx
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "adjustment"),
        eq(transactionsTable.toEmployeeId, employeeId),
        eq(transactionsTable.note, STARTING_BALANCE_NOTE),
      ),
    )
    .orderBy(asc(transactionsTable.createdAt), asc(transactionsTable.id))
    .limit(1);

  if (!original) {
    return { hasStartingBalance: false, originalAmount: null, effectiveAmount: null, correctionCount: 0 };
  }

  const corrections = await trx
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "adjustment"),
        or(
          eq(transactionsTable.toEmployeeId, employeeId),
          eq(transactionsTable.fromEmployeeId, employeeId),
        ),
        like(transactionsTable.note, `${STARTING_BALANCE_CORRECTION_PREFIX}%`),
      ),
    );

  let effective = original.amount;
  for (const c of corrections) {
    if (c.toEmployeeId === employeeId) effective += c.amount;
    else effective -= c.amount;
  }

  return {
    hasStartingBalance: true,
    originalAmount: original.amount,
    effectiveAmount: effective,
    correctionCount: corrections.length,
  };
}
