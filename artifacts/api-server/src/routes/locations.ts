import { Router } from "express";
import type { IRouter } from "express";
import { db, locationsTable, employeesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  ListLocationsResponse,
  CreateLocationBody,
  CreateLocationResponse,
  UpdateLocationParams,
  UpdateLocationBody,
  UpdateLocationResponse,
  DeleteLocationParams,
  ReassignLocationParams,
  ReassignLocationBody,
  ReassignLocationResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

async function getEmployeeCounts(): Promise<Map<number, number>> {
  const counts = await db
    .select({ locationId: employeesTable.locationId, count: sql<number>`count(*)::int` })
    .from(employeesTable)
    .groupBy(employeesTable.locationId);
  const map = new Map<number, number>();
  for (const c of counts) {
    if (c.locationId != null) map.set(c.locationId, Number(c.count));
  }
  return map;
}

// Any authenticated user can read the list (needed for dropdowns/filters).
router.get("/locations", requireAuth, async (_req, res): Promise<void> => {
  const [rows, countMap] = await Promise.all([
    db.select().from(locationsTable).orderBy(locationsTable.name),
    getEmployeeCounts(),
  ]);
  const result = rows.map((l) => ({ id: l.id, name: l.name, employeeCount: countMap.get(l.id) ?? 0 }));
  res.json(ListLocationsResponse.parse(result));
});

router.post("/locations", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = CreateLocationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const name = body.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Name cannot be empty" });
    return;
  }

  const [existing] = await db.select().from(locationsTable).where(eq(locationsTable.name, name)).limit(1);
  if (existing) {
    res.status(409).json({ error: "A location with that name already exists" });
    return;
  }

  const [created] = await db.insert(locationsTable).values({ name }).returning();
  res.status(201).json(CreateLocationResponse.parse({ id: created.id, name: created.name, employeeCount: 0 }));
});

router.patch("/locations/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = UpdateLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateLocationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const name = body.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Name cannot be empty" });
    return;
  }

  const [existing] = await db.select().from(locationsTable).where(eq(locationsTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Location not found" });
    return;
  }

  const [nameClash] = await db.select().from(locationsTable).where(eq(locationsTable.name, name)).limit(1);
  if (nameClash && nameClash.id !== params.data.id) {
    res.status(409).json({ error: "A location with that name already exists" });
    return;
  }

  const [updated] = await db
    .update(locationsTable)
    .set({ name })
    .where(eq(locationsTable.id, params.data.id))
    .returning();

  const countMap = await getEmployeeCounts();
  res.json(UpdateLocationResponse.parse({ id: updated.id, name: updated.name, employeeCount: countMap.get(updated.id) ?? 0 }));
});

router.delete("/locations/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = DeleteLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(locationsTable).where(eq(locationsTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Location not found" });
    return;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(employeesTable)
    .where(eq(employeesTable.locationId, params.data.id));

  if (Number(count) > 0) {
    res.status(409).json({
      error: `Cannot delete: ${count} employee(s) are still assigned to this location. Reassign them first.`,
    });
    return;
  }

  await db.delete(locationsTable).where(eq(locationsTable.id, params.data.id));
  res.status(204).send();
});

// Move all employees out of a location (to another one, or clear them) so it
// can be deleted. reassignTo === null clears the assignment.
router.post("/locations/:id/reassign", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = ReassignLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ReassignLocationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db.select().from(locationsTable).where(eq(locationsTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Location not found" });
    return;
  }

  const target = body.data.reassignTo;
  if (target !== null) {
    if (target === params.data.id) {
      res.status(400).json({ error: "Cannot reassign employees to the same location" });
      return;
    }
    const [targetLoc] = await db.select().from(locationsTable).where(eq(locationsTable.id, target)).limit(1);
    if (!targetLoc) {
      res.status(400).json({ error: "Target location not found" });
      return;
    }
  }

  const updated = await db
    .update(employeesTable)
    .set({ locationId: target })
    .where(eq(employeesTable.locationId, params.data.id))
    .returning({ id: employeesTable.id });

  res.json(ReassignLocationResponse.parse({ reassigned: updated.length }));
});

export default router;
