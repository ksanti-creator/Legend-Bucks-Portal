import { Router } from "express";
import type { IRouter } from "express";
import { db, employeesTable, magicTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  RequestMagicLinkBody,
  VerifyMagicLinkBody,
  InviteEmployeeBody,
  GetMeResponse,
  RequestMagicLinkResponse,
  VerifyMagicLinkResponse,
  InviteEmployeeResponse,
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
      location,
      managerId: user.managerId,
      status: user.status,
      balance,
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

export default router;
