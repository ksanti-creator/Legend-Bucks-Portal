import { pgTable, serial, timestamp, integer, text, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionTypeEnum = pgEnum("transaction_type", [
  "award",
  "redemption_debit",
  "refund",
  "contribution",
  "adjustment",
]);

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  type: transactionTypeEnum("type").notNull(),
  amount: integer("amount").notNull(), // positive = credit, stored as absolute; direction determined by type+parties
  fromEmployeeId: integer("from_employee_id"),
  toEmployeeId: integer("to_employee_id"),
  note: text("note"),
  redemptionId: integer("redemption_id"),
  goalId: integer("goal_id"),
  // Who recorded the transaction, when it wasn't initiated by from/to parties.
  // Used for admin balance adjustments so the ledger shows who entered them.
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
