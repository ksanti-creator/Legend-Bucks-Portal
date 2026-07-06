import { pgTable, serial, timestamp, integer, text, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const redemptionStatusEnum = pgEnum("redemption_status", [
  "requested",
  "approved",
  "rejected",
  "fulfilled",
  "cancelled",
]);

export const redemptionsTable = pgTable("redemptions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  rewardId: integer("reward_id").notNull(),
  status: redemptionStatusEnum("status").notNull().default("requested"),
  buckCost: integer("buck_cost").notNull(), // snapshot of cost at time of redemption
  note: text("note"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRedemptionSchema = createInsertSchema(redemptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRedemption = z.infer<typeof insertRedemptionSchema>;
export type Redemption = typeof redemptionsTable.$inferSelect;
