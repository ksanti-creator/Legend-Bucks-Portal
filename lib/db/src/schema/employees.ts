import { pgTable, text, serial, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";
import { locationsTable } from "./locations";

export const roleEnum = pgEnum("employee_role", ["admin", "manager", "team_member", "accounting_admin"]);
export const statusEnum = pgEnum("employee_status", ["active", "inactive", "invited"]);

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  locationId: integer("location_id").references(() => locationsTable.id),
  managerId: integer("manager_id"),
  role: roleEnum("role").notNull().default("team_member"),
  status: statusEnum("status").notNull().default("invited"),
  // Optional yearly award budget (in bucks) this user (a manager/admin) may
  // draw down when awarding bucks to others within a UTC calendar year.
  // null = no budget set = cannot award. Resets each year, no carryover.
  // Admin-only to set; a user may read their own remaining budget.
  awardBudgetYearly: integer("award_budget_yearly"),
  // Per-user email notification opt-outs. Default true = opted in.
  notifyBucksReceived: boolean("notify_bucks_received").notNull().default(true),
  notifyRedemptionUpdates: boolean("notify_redemption_updates").notNull().default(true),
  // Approver-side opt-out: emails to admins/managers when a new redemption comes in.
  notifyNewRedemptionRequests: boolean("notify_new_redemption_requests").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
