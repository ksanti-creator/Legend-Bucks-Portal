import crypto from "crypto";
import { db, sessionsTable, magicTokensTable, employeesTable } from "@workspace/db";
import type { Employee } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

// Typed request augmentation
declare global {
  namespace Express {
    interface Request {
      currentUser?: Employee;
    }
  }
}

export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

export async function createMagicToken(employeeId: number): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
  await db.insert(magicTokensTable).values({ employeeId, token, expiresAt });
  return token;
}

export async function verifyMagicToken(token: string): Promise<number | null> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(magicTokensTable)
    .where(
      and(
        eq(magicTokensTable.token, token),
        gt(magicTokensTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row || row.usedAt) return null;

  await db
    .update(magicTokensTable)
    .set({ usedAt: now })
    .where(eq(magicTokensTable.id, row.id));

  return row.employeeId;
}

export async function createSession(employeeId: number): Promise<string> {
  const sessionToken = generateToken(48);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await db.insert(sessionsTable).values({ employeeId, sessionToken, expiresAt });
  return sessionToken;
}

export async function getSessionEmployee(sessionToken: string) {
  const now = new Date();
  const [row] = await db
    .select({ session: sessionsTable, employee: employeesTable })
    .from(sessionsTable)
    .innerJoin(employeesTable, eq(sessionsTable.employeeId, employeesTable.id))
    .where(and(eq(sessionsTable.sessionToken, sessionToken), gt(sessionsTable.expiresAt, now)))
    .limit(1);

  return row ? row.employee : null;
}

export function extractSessionToken(req: Request): string | undefined {
  // Prefer the Authorization: Bearer header (works inside the Replit preview
  // iframe where third-party cookies are blocked), fall back to the cookie.
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const bearer = authHeader.slice("Bearer ".length).trim();
    if (bearer) return bearer;
  }
  return req.cookies?.["session_token"];
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractSessionToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const employee = await getSessionEmployee(token);
  if (!employee || employee.status === "inactive") {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  req.currentUser = employee;
  next();
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.currentUser;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/**
 * Roles allowed to see accounting data — the full ledger, CSV export, and
 * dollar-cost (CAD) values. This is a read-only capability: full admins have it
 * as part of their broader powers, and the read-only accounting_admin role has
 * it too. It grants NO write access; every write endpoint stays admin-only.
 */
export function canViewAccounting(role: string): boolean {
  return role === "admin" || role === "accounting_admin";
}

/**
 * Roles allowed to AWARD/SEND bucks to other people (creates 'award' ledger
 * rows). Managers are additionally budget-capped at the call site.
 *
 * This is deliberately a positive allow-list, not an exclusion check: any role
 * NOT named here is denied by default, so a future view-only/finance role can
 * never silently inherit the ability to move bucks.
 */
export function canAwardBucks(role: string): boolean {
  return role === "admin" || role === "manager";
}

/**
 * Roles allowed to SPEND their own balance — redeem rewards, contribute to
 * goals, and cancel their own pending redemption (all of which write ledger
 * rows). Every role that holds a spendable balance is named here.
 *
 * Positive allow-list on purpose: read-only roles like accounting_admin (and
 * any future view-only role) are excluded by omission and can never move bucks.
 */
export function canSpendBucks(role: string): boolean {
  return role === "admin" || role === "manager" || role === "team_member";
}

export function getCurrentUser(req: Request): Employee {
  const user = req.currentUser;
  if (!user) throw new Error("getCurrentUser called outside auth middleware");
  return user;
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sessionToken, sessionToken));
}

export async function getEmployeeBalance(employeeId: number): Promise<number> {
  // Balance = total credits (awards, refunds, positive adjustments) minus debits (redemption_debit, contribution, negative adjustments)
  const result = await db.execute<{ balance: string }>(
    `SELECT COALESCE(
      SUM(CASE
        WHEN type IN ('award','refund') AND to_employee_id = ${employeeId} THEN amount
        WHEN type = 'adjustment' AND to_employee_id = ${employeeId} THEN amount
        WHEN type IN ('redemption_debit','contribution') AND from_employee_id = ${employeeId} THEN -amount
        WHEN type = 'adjustment' AND from_employee_id = ${employeeId} THEN -amount
        ELSE 0
      END), 0) AS balance
     FROM transactions`
  );
  return parseInt(result.rows[0]?.balance ?? "0", 10);
}
