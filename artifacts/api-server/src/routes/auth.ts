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
} from "../lib/auth";

const router: IRouter = Router();

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  const balance = await getEmployeeBalance(user.id);
  res.json(
    GetMeResponse.parse({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      department: user.department,
      location: user.location,
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

  req.log.info({ employeeId: employee.id }, "Magic link generated");

  // In production you'd send an email; in dev we return the token for easy testing
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
  res.cookie("session_token", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  const balance = await getEmployeeBalance(employee.id);
  res.json(
    VerifyMagicLinkResponse.parse({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      role: employee.role,
      department: employee.department,
      location: employee.location,
      managerId: employee.managerId,
      status: employee.status,
      balance,
    }),
  );
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.["session_token"];
  if (token) {
    await deleteSession(token);
  }
  res.clearCookie("session_token", { path: "/" });
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

  const [employee] = await db
    .insert(employeesTable)
    .values({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      department: parsed.data.department ?? null,
      location: parsed.data.location ?? null,
      managerId: parsed.data.managerId ?? null,
      status: "invited",
    })
    .returning();

  // Generate magic token for invitation (do NOT log the token itself)
  const token = await createMagicToken(employee.id);
  req.log.info({ employeeId: employee.id }, "Invite sent");
  // In production you'd email the token; in dev we surface it on the response only
  void token;

  res.status(201).json(
    InviteEmployeeResponse.parse({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      role: employee.role,
      department: employee.department,
      location: employee.location,
      managerId: employee.managerId,
      managerName: null,
      status: employee.status,
      balance: null,
      createdAt: employee.createdAt.toISOString(),
    }),
  );
});

export default router;
