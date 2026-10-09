import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, isTraining, departmentsTable, locationsTable, employeesTable, rewardsTable, storesTable, storeAccessTable, transactionsTable, goalsTable } from "@workspace/db";
import { trainingStateTable, trainingAuditTable } from "@workspace/db/training-schema";

export const trainingPersonas = [
  { key: "admin", label: "Training Administrator", role: "admin" },
  { key: "manager", label: "Training Manager", role: "manager" },
  { key: "employee", label: "Training Employee", role: "team_member" },
  { key: "accounting", label: "Training Accounting", role: "accounting_admin" },
  { key: "operator", label: "Training Store Operator", role: "team_member" },
] as const;
export const personaEmail = (key: string) => `training.${key}@example.test`;

/** Caller MUST hold the exclusive training-reset transaction lock. */
export async function resetTrainingData(actor: string) {
  if (!isTraining()) throw new Error("Training context required");
  // Fixed identifiers only. DELETE preserves sequences so old card/user IDs
  // cannot accidentally identify newly seeded records after reset.
  for (const table of [
    "training_outbox", "store_card_lookup_tokens", "store_card_ledger",
    "gift_card_issues", "redemptions", "goal_contributions", "goals",
    "transactions", "sessions", "magic_tokens", "store_access", "stores",
    "reward_sizes", "rewards", "employees", "departments", "locations", "app_settings",
  ]) await db.execute(sql.raw(`DELETE FROM public."${table}"`));

  const [department] = await db.insert(departmentsTable).values({ name: "TRAINING — Practice Team" }).returning();
  const [location] = await db.insert(locationsTable).values({ name: "TRAINING — Whitefish" }).returning();
  const people = new Map<string, number>();
  for (const persona of trainingPersonas) {
    const [employee] = await db.insert(employeesTable).values({
      firstName: "Training", lastName: persona.label.replace("Training ", ""),
      email: personaEmail(persona.key), role: persona.role, status: "active",
      departmentId: department.id, locationId: location.id,
      managerId: persona.key === "employee" ? people.get("manager") : null,
      awardBudgetYearly: ["admin", "manager"].includes(persona.role) ? 10000 : null,
    }).returning();
    people.set(persona.key, employee.id);
  }
  await db.update(employeesTable).set({ managerId: people.get("admin") }).where(eq(employeesTable.id, people.get("manager")!));
  for (const key of ["admin", "manager", "employee", "operator"]) {
    await db.insert(transactionsTable).values({
      type: "adjustment", toEmployeeId: people.get(key), amount: 1000,
      note: "TRAINING — Dummy starting balance; no monetary value",
      createdById: people.get("admin")!,
    });
  }
  const [store] = await db.insert(storesTable).values({ name: "TRAINING — Whitefish Till", locationId: location.id }).returning();
  await db.insert(storeAccessTable).values({ storeId: store.id, employeeId: people.get("operator")! });
  await db.insert(rewardsTable).values([
    { name: "TRAINING — Gift Card", category: "Gift Cards", buckCost: 100, active: true, approvalRequired: true,
      isCustomGiftCard: true, giftCardIncrementLb: 100, giftCardMinimumLb: 100, giftCardMaximumLb: 1000,
      description: "Dummy gift card. Simulated email only. Cannot be used at a real till." },
    { name: "TRAINING — Team Hat", category: "Merchandise", buckCost: 50, quantity: 20, active: true, approvalRequired: true },
    { name: "TRAINING — Time Off", category: "Time Off", buckCost: 100, active: true, approvalRequired: true },
  ]);
  await db.insert(goalsTable).values({
    name: "TRAINING — Team Lunch", departmentId: department.id, targetAmount: 500,
    description: "Practice contributions using dummy bucks only.",
  });
  const generation = randomUUID();
  await db.update(trainingStateTable).set({ generation, seedVersion: 1, seededAt: new Date() }).where(eq(trainingStateTable.id, 1));
  await db.insert(trainingAuditTable).values({
    generation, actor, action: "reset", details: { notice: "TRAINING — DUMMY DATA", sessionsRevoked: true },
  });
}
