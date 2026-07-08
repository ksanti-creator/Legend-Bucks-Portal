import { Router, type IRouter } from "express";
import { db, employeesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * ONE-TIME BOOTSTRAP / RESET ENDPOINT.
 *
 * Wipes ALL application data and seeds a single admin account. This is used to
 * clear out test/seed data from an environment (development or production) and
 * establish the first real admin, since there is no public signup and the
 * invite flow requires an existing admin.
 *
 * Guarded by the BOOTSTRAP_SECRET env var: if the var is unset the endpoint is
 * disabled, and callers must present the exact value in the `x-bootstrap-secret`
 * header. This route (and the secret) is intended to be removed immediately
 * after use.
 */
router.post("/bootstrap/reset", async (req, res): Promise<void> => {
  const secret = process.env.BOOTSTRAP_SECRET;
  if (!secret) {
    res.status(403).json({ error: "Bootstrap is disabled" });
    return;
  }

  const provided = req.get("x-bootstrap-secret");
  if (!provided || provided !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const admin = {
    firstName: "Kayleigh",
    lastName: "Santi",
    email: "ksanti@legendboats.com",
  };

  // Wipe every application table and reset identity sequences so the new admin
  // starts from a clean slate. CASCADE covers all FK dependencies.
  await db.execute(sql`
    TRUNCATE TABLE
      transactions,
      redemptions,
      goal_contributions,
      goals,
      team_budgets,
      sessions,
      magic_tokens,
      employees,
      departments,
      locations,
      rewards
    RESTART IDENTITY CASCADE
  `);

  const [created] = await db
    .insert(employeesTable)
    .values({
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: admin.email.toLowerCase(),
      role: "admin",
      status: "active",
    })
    .returning();

  req.log.warn({ adminId: created.id }, "Bootstrap reset executed: all data wiped, admin seeded");

  res.json({
    ok: true,
    admin: {
      id: created.id,
      firstName: created.firstName,
      lastName: created.lastName,
      email: created.email,
      role: created.role,
      status: created.status,
    },
  });
});

export default router;
