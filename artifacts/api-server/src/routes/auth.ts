import { Router } from "express";
import type { IRouter } from "express";
import { db, employeesTable, magicTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  RequestMagicLinkBody,
  VerifyMagicLinkBody,
  InviteEmployeeBody,
  BulkInviteEmployeesBody,
  BulkInviteEmployeesResponse,
  GetMeResponse,
  RequestMagicLinkResponse,
  VerifyMagicLinkResponse,
  InviteEmployeeResponse,
  UpdateNotificationPreferencesBody,
  UpdateNotificationPreferencesResponse,
} from "@workspace/api-zod";
import {
  createMagicToken,
  verifyMagicToken,
  createSession,
  requireAuth,
  getCurrentUser,
  deleteSession,
  getEmployeeBalance,
  extractSessionToken,
} from "../lib/auth";
import { sendMagicLinkEmail, sendInviteEmail } from "../lib/email";
import { resolveOrgNames, validateOrgIds } from "../lib/org";

const router: IRouter = Router();

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const balance = await getEmployeeBalance(user.id);
  const { department, location } = await resolveOrgNames(user.departmentId, user.locationId);
  res.json(
    GetMeResponse.parse({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      department,
      departmentId: user.departmentId,
      location,
      managerId: user.managerId,
      status: user.status,
      balance,
      notifyBucksReceived: user.notifyBucksReceived,
      notifyRedemptionUpdates: user.notifyRedemptionUpdates,
      notifyNewRedemptionRequests: user.notifyNewRedemptionRequests,
    }),
  );
});

// Any authenticated user can manage their own email notification preferences.
router.patch("/auth/me/notifications", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const body = UpdateNotificationPreferencesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [updated] = await db
    .update(employeesTable)
    .set({
      notifyBucksReceived: body.data.notifyBucksReceived,
      notifyRedemptionUpdates: body.data.notifyRedemptionUpdates,
      notifyNewRedemptionRequests: body.data.notifyNewRedemptionRequests,
    })
    .where(eq(employeesTable.id, user.id))
    .returning();

  res.json(
    UpdateNotificationPreferencesResponse.parse({
      notifyBucksReceived: updated.notifyBucksReceived,
      notifyRedemptionUpdates: updated.notifyRedemptionUpdates,
      notifyNewRedemptionRequests: updated.notifyNewRedemptionRequests,
    }),
  );
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = RequestMagicLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.email, parsed.data.email.toLowerCase()))
    .limit(1);

  if (!employee || employee.status === "inactive") {
    // Don't reveal whether the user exists
    res.json(RequestMagicLinkResponse.parse({ message: "If that email is registered, you will receive a magic link." }));
    return;
  }

  const token = await createMagicToken(employee.id);

  // Send the magic link email; also surface the token in dev for easy testing
  try {
    await sendMagicLinkEmail(employee.email, employee.firstName, token);
    req.log.info({ employeeId: employee.id }, "Magic link email sent");
  } catch (err) {
    req.log.error({ err, employeeId: employee.id }, "Failed to send magic link email");
    // Don't block login — fall through so dev token is still returned
  }

  const isDev = process.env.NODE_ENV !== "production";
  res.json(
    RequestMagicLinkResponse.parse({
      message: "Magic link sent! Check your email.",
      token: isDev ? token : null,
    }),
  );
});

router.post("/auth/verify", async (req, res): Promise<void> => {
  const parsed = VerifyMagicLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const employeeId = await verifyMagicToken(parsed.data.token);
  if (!employeeId) {
    res.status(400).json({ error: "Invalid or expired token" });
    return;
  }

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);

  if (!employee || employee.status === "inactive") {
    res.status(400).json({ error: "Account not active" });
    return;
  }

  // Mark invited users as active on first login
  if (employee.status === "invited") {
    await db
      .update(employeesTable)
      .set({ status: "active" })
      .where(eq(employeesTable.id, employee.id));
    employee.status = "active";
  }

  const sessionToken = await createSession(employee.id);
  // SameSite=None + Secure is required so the cookie works inside Replit's
  // preview iframe (cross-site from replit.com to <repl>.replit.dev).
  res.cookie("session_token", sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  const balance = await getEmployeeBalance(employee.id);
  const { department, location } = await resolveOrgNames(employee.departmentId, employee.locationId);
  res.json(
    VerifyMagicLinkResponse.parse({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      role: employee.role,
      department,
      departmentId: employee.departmentId,
      location,
      managerId: employee.managerId,
      status: employee.status,
      balance,
      // Also returned in the body so the client can store it and authenticate
      // via Authorization: Bearer — required inside the Replit preview iframe
      // where third-party cookies are blocked.
      token: sessionToken,
    }),
  );
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  // Revoke whichever token the client presented — Bearer header (token mode)
  // or cookie — so the server session is actually invalidated on logout.
  const token = extractSessionToken(req);
  if (token) {
    await deleteSession(token);
  }
  res.clearCookie("session_token", { path: "/", httpOnly: true, secure: true, sameSite: "none" });
  res.sendStatus(204);
});

router.post("/auth/invite", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Only admins can invite employees" });
    return;
  }

  const parsed = InviteEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.email, parsed.data.email.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    res.status(400).json({ error: "An employee with that email already exists" });
    return;
  }

  const orgError = await validateOrgIds(parsed.data.departmentId, parsed.data.locationId);
  if (orgError) {
    res.status(400).json({ error: orgError });
    return;
  }

  const [employee] = await db
    .insert(employeesTable)
    .values({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      departmentId: parsed.data.departmentId ?? null,
      locationId: parsed.data.locationId ?? null,
      managerId: parsed.data.managerId ?? null,
      awardBudgetYearly: parsed.data.awardBudgetYearly ?? null,
      status: "invited",
    })
    .returning();

  const orgNames = await resolveOrgNames(employee.departmentId, employee.locationId);

  // Generate magic token and email the invitation
  const token = await createMagicToken(employee.id);
  const inviterName = `${user.firstName} ${user.lastName}`;
  try {
    await sendInviteEmail(employee.email, employee.firstName, inviterName, token);
    req.log.info({ employeeId: employee.id }, "Invite email sent");
  } catch (err) {
    req.log.error({ err, employeeId: employee.id }, "Failed to send invite email");
  }

  res.status(201).json(
    InviteEmployeeResponse.parse({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      role: employee.role,
      department: orgNames.department,
      location: orgNames.location,
      departmentId: employee.departmentId ?? null,
      locationId: employee.locationId ?? null,
      managerId: employee.managerId,
      managerName: null,
      status: employee.status,
      balance: null,
      createdAt: employee.createdAt.toISOString(),
    }),
  );
});

/**
 * POST /auth/bulk-invite
 *
 * Admin-only bulk invite (spreadsheet upload). Validates each row
 * independently and returns per-row results — good rows are invited even when
 * others fail, and rows whose email already exists are skipped (making a
 * retry after partial success safe: nothing is double-invited).
 */
router.post("/auth/bulk-invite", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Only admins can bulk invite employees" });
    return;
  }

  const parsed = BulkInviteEmployeesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const invites = parsed.data.invites;

  // Pre-load reference data once for the whole batch.
  const allEmployees = await db.select().from(employeesTable);
  const existingEmails = new Set(allEmployees.map((e) => e.email.toLowerCase()));
  const employeesById = new Map(allEmployees.map((e) => [e.id, e]));

  const inviterName = `${user.firstName} ${user.lastName}`;
  const seenInBatch = new Set<string>();
  const results: {
    index: number;
    email: string;
    status: "invited" | "skipped";
    error: string | null;
    id: number | null;
  }[] = [];

  for (let i = 0; i < invites.length; i++) {
    const row = invites[i];
    const email = row.email.toLowerCase().trim();

    const skip = (error: string) => {
      results.push({ index: i, email: row.email, status: "skipped", error, id: null });
    };

    if (seenInBatch.has(email)) {
      skip("Duplicate email within the uploaded file");
      continue;
    }
    seenInBatch.add(email);

    if (existingEmails.has(email)) {
      skip("An employee with this email already exists");
      continue;
    }

    if (row.managerId != null) {
      const mgr = employeesById.get(row.managerId);
      if (!mgr) {
        skip("Manager not found");
        continue;
      }
      if (mgr.role !== "manager" && mgr.role !== "admin") {
        skip("Assigned manager must have the manager or admin role");
        continue;
      }
    }

    // Only awarding roles may carry a yearly award budget.
    if (row.awardBudgetYearly != null && row.role !== "admin" && row.role !== "manager") {
      skip("Only admins and managers can have a yearly award budget");
      continue;
    }

    const orgError = await validateOrgIds(row.departmentId ?? null, row.locationId ?? null);
    if (orgError) {
      skip(orgError);
      continue;
    }

    try {
      const [employee] = await db
        .insert(employeesTable)
        .values({
          firstName: row.firstName,
          lastName: row.lastName,
          email,
          role: row.role,
          departmentId: row.departmentId ?? null,
          locationId: row.locationId ?? null,
          managerId: row.managerId ?? null,
          awardBudgetYearly: row.awardBudgetYearly ?? null,
          status: "invited",
        })
        .returning();

      existingEmails.add(email);
      employeesById.set(employee.id, employee);

      // Best-effort email: the account exists either way, and the employee can
      // still log in via magic link. Same behavior as the single invite.
      try {
        const token = await createMagicToken(employee.id);
        await sendInviteEmail(employee.email, employee.firstName, inviterName, token);
      } catch (err) {
        req.log.error({ err, employeeId: employee.id }, "Failed to send bulk invite email");
      }

      results.push({ index: i, email: row.email, status: "invited", error: null, id: employee.id });
    } catch (err) {
      req.log.error({ err, email }, "Bulk invite row failed");
      skip("Could not create this employee — please try again");
    }
  }

  const invitedCount = results.filter((r) => r.status === "invited").length;
  res.json(
    BulkInviteEmployeesResponse.parse({
      invitedCount,
      skippedCount: results.length - invitedCount,
      results,
    }),
  );
});

export default router;
