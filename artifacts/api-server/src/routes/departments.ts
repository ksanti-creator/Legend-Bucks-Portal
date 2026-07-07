import { Router } from "express";
import type { IRouter } from "express";
import { db, departmentsTable, employeesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  ListDepartmentsResponse,
  CreateDepartmentBody,
  CreateDepartmentResponse,
  UpdateDepartmentParams,
  UpdateDepartmentBody,
  UpdateDepartmentResponse,
  DeleteDepartmentParams,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

async function getEmployeeCounts(): Promise<Map<number, number>> {
  const counts = await db
    .select({ departmentId: employeesTable.departmentId, count: sql<number>`count(*)::int` })
    .from(employeesTable)
    .groupBy(employeesTable.departmentId);
  const map = new Map<number, number>();
  for (const c of counts) {
    if (c.departmentId != null) map.set(c.departmentId, Number(c.count));
  }
  return map;
}

// Any authenticated user can read the list (needed for dropdowns/filters).
router.get("/departments", requireAuth, async (_req, res): Promise<void> => {
  const [rows, countMap] = await Promise.all([
    db.select().from(departmentsTable).orderBy(departmentsTable.name),
    getEmployeeCounts(),
  ]);
  const result = rows.map((d) => ({ id: d.id, name: d.name, employeeCount: countMap.get(d.id) ?? 0 }));
  res.json(ListDepartmentsResponse.parse(result));
});

router.post("/departments", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = CreateDepartmentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const name = body.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Name cannot be empty" });
    return;
  }

  const [existing] = await db.select().from(departmentsTable).where(eq(departmentsTable.name, name)).limit(1);
  if (existing) {
    res.status(409).json({ error: "A department with that name already exists" });
    return;
  }

  const [created] = await db.insert(departmentsTable).values({ name }).returning();
  res.status(201).json(CreateDepartmentResponse.parse({ id: created.id, name: created.name, employeeCount: 0 }));
});

router.patch("/departments/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = UpdateDepartmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateDepartmentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const name = body.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Name cannot be empty" });
    return;
  }

  const [existing] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const [nameClash] = await db.select().from(departmentsTable).where(eq(departmentsTable.name, name)).limit(1);
  if (nameClash && nameClash.id !== params.data.id) {
    res.status(409).json({ error: "A department with that name already exists" });
    return;
  }

  const [updated] = await db
    .update(departmentsTable)
    .set({ name })
    .where(eq(departmentsTable.id, params.data.id))
    .returning();

  const countMap = await getEmployeeCounts();
  res.json(UpdateDepartmentResponse.parse({ id: updated.id, name: updated.name, employeeCount: countMap.get(updated.id) ?? 0 }));
});

router.delete("/departments/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = DeleteDepartmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(employeesTable)
    .where(eq(employeesTable.departmentId, params.data.id));

  if (Number(count) > 0) {
    res.status(409).json({
      error: `Cannot delete: ${count} employee(s) are still assigned to this department. Reassign them first.`,
    });
    return;
  }

  await db.delete(departmentsTable).where(eq(departmentsTable.id, params.data.id));
  res.status(204).send();
});

export default router;
