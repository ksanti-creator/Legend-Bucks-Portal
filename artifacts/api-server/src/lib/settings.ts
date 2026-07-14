import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Global application settings, stored in a simple key/value table.
 *
 * "max_single_award": the maximum bucks allowed in a single award. An absent
 * row means there is no limit.
 */
const MAX_SINGLE_AWARD_KEY = "max_single_award";

/** The configured maximum single award, or null when no limit is set. */
export async function getMaxSingleAward(): Promise<number | null> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, MAX_SINGLE_AWARD_KEY))
    .limit(1);
  if (!row) return null;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Set the maximum single award, or pass null to remove the limit. */
export async function setMaxSingleAward(value: number | null): Promise<void> {
  if (value == null) {
    await db.delete(appSettingsTable).where(eq(appSettingsTable.key, MAX_SINGLE_AWARD_KEY));
    return;
  }
  await db
    .insert(appSettingsTable)
    .values({ key: MAX_SINGLE_AWARD_KEY, value: String(value) })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: String(value), updatedAt: new Date() },
    });
}
