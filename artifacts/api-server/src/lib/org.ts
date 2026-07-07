import { db, departmentsTable, locationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Resolves the display names for an employee's department and location FKs.
 * Names are the single source of truth in the managed lists — employees only
 * store the FK ids, and responses expose the resolved names for display.
 */
export async function resolveOrgNames(
  departmentId: number | null | undefined,
  locationId: number | null | undefined,
): Promise<{ department: string | null; location: string | null }> {
  let department: string | null = null;
  let location: string | null = null;

  if (departmentId != null) {
    const [d] = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.id, departmentId))
      .limit(1);
    department = d?.name ?? null;
  }
  if (locationId != null) {
    const [l] = await db
      .select()
      .from(locationsTable)
      .where(eq(locationsTable.id, locationId))
      .limit(1);
    location = l?.name ?? null;
  }

  return { department, location };
}

/**
 * Validates that the given department/location ids exist. Returns an error
 * message string if one is missing, or null if all provided ids are valid.
 * Gives callers a clean 400 instead of a raw DB foreign-key failure.
 */
export async function validateOrgIds(
  departmentId: number | null | undefined,
  locationId: number | null | undefined,
): Promise<string | null> {
  if (departmentId != null) {
    const [d] = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.id, departmentId))
      .limit(1);
    if (!d) return "Department not found";
  }
  if (locationId != null) {
    const [l] = await db
      .select()
      .from(locationsTable)
      .where(eq(locationsTable.id, locationId))
      .limit(1);
    if (!l) return "Location not found";
  }
  return null;
}
