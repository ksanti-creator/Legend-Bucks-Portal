import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";
import { locationsTable } from "./locations";

export const roleEnum = pgEnum("employee_role", ["admin", "manager", "team_member"]);
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
