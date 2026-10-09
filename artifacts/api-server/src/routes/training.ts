import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, employeesTable, giftCardIssuesTable, storeAccessTable } from "@workspace/db";
import { trainingOutboxTable, trainingStateTable, trainingAuditTable } from "@workspace/db/training-schema";
import { withTrainingTransaction } from "@workspace/db/training-runtime";
import { verifyTrainingDatabase } from "@workspace/db/training-preflight";
import { requireAuth, getCurrentUser, createSession, deleteSession, extractSessionToken } from "../lib/auth";
import { trainingPersonas, personaEmail, resetTrainingData } from "../lib/training-data";
import { trainingBoundary } from "../lib/training-boundary";
import realRoutes from "./index";

const router = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/status", async (_req, res) => {
  if (process.env.TRAINING_MODE_ENABLED !== "true") {
    res.json({ enabled: false, available: false, seeded: false, reason: "Training is disabled pending acceptance and release approval." }); return;
  }
  try {
    const check = await verifyTrainingDatabase();
    if (!check.restricted || !check.initialized) throw new Error("Not ready");
    const seeded = await withTrainingTransaction(async () => {
      const [state] = await db.select().from(trainingStateTable);
      return state?.seedVersion === 1;
    }, { requireSeed: false });
    res.json({ enabled: true, available: true, seeded, reason: seeded ? "TRAINING — DUMMY DATA" : "An administrator must initialize dummy data." });
  } catch {
    res.status(503).json({ enabled: true, available: false, seeded: false, reason: "Training isolation checks failed. No live fallback." });
  }
});

const simulated = Router();
simulated.get("/training/outbox", requireAuth, async (req, res) => {
  if (!["admin", "accounting_admin"].includes(getCurrentUser(req).role)) { res.sendStatus(403); return; }
  const messages = await db.select().from(trainingOutboxTable).orderBy(desc(trainingOutboxTable.id)).limit(100);
  res.json({ messages });
});
simulated.get("/training/cards", requireAuth, async (req, res) => {
  const user = getCurrentUser(req);
  const grants = await db.select().from(storeAccessTable).where(eq(storeAccessTable.employeeId, user.id));
  if (user.role !== "admin" && !grants.length) { res.sendStatus(403); return; }
  const cards = await db.select({
    id: giftCardIssuesTable.id, status: giftCardIssuesTable.status, cadValueCents: giftCardIssuesTable.cadValueCents,
  }).from(giftCardIssuesTable).orderBy(desc(giftCardIssuesTable.id)).limit(100);
  res.json({ cards: cards.map(card => ({ ...card, alias: `TRAINING-CARD-${card.id}` })) });
});
// Never clear or set the normal portal's session cookie from training.
simulated.post("/auth/logout", requireAuth, async (req, res) => {
  await deleteSession(extractSessionToken(req)!);
  res.json({ success: true });
});
simulated.use(realRoutes);
router.use("/api", trainingBoundary(simulated));

// Admission/reset endpoints remain OUTSIDE training context. Only a real,
// active portal admin can launch a dummy persona; role names from the browser
// are never trusted as authorization.
router.use(requireAuth, (req, res, next) => {
  if (getCurrentUser(req).role !== "admin" || getCurrentUser(req).status !== "active") { res.sendStatus(403); return; }
  if (process.env.TRAINING_MODE_ENABLED !== "true") { res.status(503).json({ error: "Training is disabled" }); return; }
  next();
});
router.get("/personas", async (_req, res) => {
  try {
    const seeded = await withTrainingTransaction(async () => {
      const [state] = await db.select().from(trainingStateTable);
      return state?.seedVersion === 1;
    }, { requireSeed: false });
    res.json({ seeded, personas: trainingPersonas });
  } catch { res.status(503).json({ error: "Training initialization is unavailable" }); }
});
router.post("/reset", async (req, res) => {
  if (req.body?.confirmation !== "RESET TRAINING DATA") { res.sendStatus(400); return; }
  try {
    const actor = `portal-admin:${getCurrentUser(req).id}`;
    await withTrainingTransaction(() => resetTrainingData(actor), { exclusive: true, requireSeed: false });
    res.json({ seeded: true });
  } catch { res.status(503).json({ error: "Training reset failed; no live fallback was used" }); }
});
router.post("/session", async (req, res) => {
  const persona = trainingPersonas.find(item => item.key === req.body?.persona);
  if (!persona) { res.sendStatus(400); return; }
  try {
    const actor = `portal-admin:${getCurrentUser(req).id}`;
    const sessionToken = await withTrainingTransaction(async () => {
      const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.email, personaEmail(persona.key)));
      if (!employee || employee.role !== persona.role || employee.status !== "active") throw new Error("Persona not available");
      const [state] = await db.select().from(trainingStateTable);
      await db.insert(trainingAuditTable).values({ generation: state.generation, actor, action: "launch", details: { persona: persona.key } });
      return createSession(employee.id);
    });
    res.json({ sessionToken, persona });
  } catch { res.status(503).json({ error: "Training session unavailable" }); }
});
// No unrecognized training path can fall through to the normal router.
router.use((_req, res) => { res.status(404).json({ error: "Training route not found" }); });
export default router;
