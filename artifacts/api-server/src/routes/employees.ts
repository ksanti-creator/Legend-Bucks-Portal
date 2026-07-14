import { Router } from "express";
import type { IRouter } from "express";
import { db, employeesTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import {
  GetEmployeeParams,
  UpdateEmployeeParams,
  UpdateEmployeeBody,
  DeactivateEmployeeParams,
  GetEmployeeBalanceParams,
  ListEmployeesQueryParams,
  ListEmployeesResponse,
  GetEmployeeResponse,
  UpdateEmployeeResponse,
  DeactivateEmployeeResponse,
  GetEmployeeBalanceResponse,
} from "@workspace/api-zod";
import { requireAuth, getCurrentUser, getEmployeeBalance } from "../lib/auth";
import { getSubtreeIds } from "../lib/orgChain";
import { resolveOrgNames, validateOrgIds } from "../lib/org";

const router: IRouter = Router();

async function buildEmployeeResponse(
  emp: any,
  opts: { withBalance?: boolean } = {},
) {
  let managerName: string | null = null;
  if (emp.managerId) {
    const [mgr] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, emp.managerId))
      .limit(1);
    if (mgr) managerName = `${mgr.firstName} ${mgr.lastName}`;
  }
  let balance: number | null = null;
  if (opts.withBalance) {
    balance = await getEmployeeBalance(emp.id);
  }
  const { department, location } = await resolveOrgNames(emp.departmentId, emp.locationId);
  return {
    id: emp.id,
    firstName: emp.firstName,
    lastName: emp.lastName,
    email: emp.email,
    department,
    location,
    departmentId: emp.departmentId ?? null,
    locationId: emp.locationId ?? null,
    managerId: emp.managerId,
    managerName,
    role: emp.role,
    status: emp.status,
    balance,
    createdAt: emp.createdAt.toISOString(),
  };
}

router.get("/employees", requireAuth, async (req, res): Promise<void> => {
  const params = ListEmployeesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let employees = await db.select().from(employeesTable).orderBy(employeesTable.lastName);

  const { departmentId, locationId, role, status, managerId } = params.data;
  if (departmentId !== undefined) employees = employees.filter((e) => e.departmentId === departmentId);
  if (locationId !== undefined) employees = employees.filter((e) => e.locationId === locationId);
  if (role) employees = employees.filter((e) => e.role === role);
  if (status) employees = employees.filter((e) => e.status === status);
  if (managerId !== undefined) {
    // Roll up to the manager's whole subtree: every direct AND indirect report
    // beneath them, not only their immediate reports.
    const subtree = new Set(await getSubtreeIds(managerId));
    employees = employees.filter((e) => subtree.has(e.id));
  }

  const result = await Promise.all(employees.map((e) => buildEmployeeResponse(e)));
  res.json(ListEmployeesResponse.parse(result));
});

router.get("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [emp] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, params.data.id))
    .limit(1);

  if (!emp) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json(GetEmployeeResponse.parse(await buildEmployeeResponse(emp, { withBalance: true })));
});

router.patch("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = UpdateEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateEmployeeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const orgError = await validateOrgIds(body.data.departmentId, body.data.locationId);
  if (orgError) {
    res.status(400).json({ error: orgError });
    return;
  }

  const updates: Record<string, any> = {};
  if (body.data.firstName !== undefined) updates.firstName = body.data.firstName;
  if (body.data.lastName !== undefined) updates.lastName = body.data.lastName;
  if ("departmentId" in body.data) updates.departmentId = body.data.departmentId;
  if ("locationId" in body.data) updates.locationId = body.data.locationId;
  if ("managerId" in body.data) updates.managerId = body.data.managerId;
  if (body.data.role !== undefined) updates.role = body.data.role;
  if (body.data.status !== undefined) updates.status = body.data.status;

  const [updated] = await db
    .update(employeesTable)
    .set(updates)
    .where(eq(employeesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json(UpdateEmployeeResponse.parse(await buildEmployeeResponse(updated, { withBalance: true })));
});

router.patch("/employees/:id/deactivate", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = DeactivateEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [updated] = await db
    .update(employeesTable)
    .set({ status: "inactive" })
    .where(eq(employeesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json(DeactivateEmployeeResponse.parse(await buildEmployeeResponse(updated)));
});

router.get("/employees/:id/balance", requireAuth, async (req, res): Promise<void> => {
  const params = GetEmployeeBalanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const user = getCurrentUser(req);
  // Only admin/manager or the employee themselves can view
  if (user.role === "team_member" && user.id !== params.data.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [emp] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, params.data.id))
    .limit(1);

  if (!emp) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  // Calculate from ledger
  const creditResult = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type IN ('award','refund') AND to_employee_id = ${emp.id}`
  );
  const debitResult = await db.execute<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type IN ('redemption_debit','contribution') AND from_employee_id = ${emp.id}`
  );

  const credits = parseInt(creditResult.rows[0]?.total ?? "0", 10);
  const debits = parseInt(debitResult.rows[0]?.total ?? "0", 10);
  const balance = credits - debits;

  res.json(
    GetEmployeeBalanceResponse.parse({
      employeeId: emp.id,
      balance,
      totalReceived: credits,
      totalSpent: debits,
    }),
  );
});

export default router;
