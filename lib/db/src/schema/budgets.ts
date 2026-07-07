import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";

/**
 * Team (department) budget pool. A per-department, per-calendar-year pool of
 * Legend Bucks that a department's managers can award toward that department's
 * team goals. Awards draw the pool down; once exhausted, further team-goal
 * awards are blocked. This is separate from an employee's personal balance —
 * team-budget awards never credit any individual.
 */
export const teamBudgetsTable = pgTable(
  "team_budgets",
  {
    id: serial("id").primaryKey(),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departmentsTable.id),
    year: integer("year").notNull(),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    deptYearUnique: uniqueIndex("team_budgets_dept_year_unique").on(t.departmentId, t.year),
  }),
);

export const insertTeamBudgetSchema = createInsertSchema(teamBudgetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTeamBudget = z.infer<typeof insertTeamBudgetSchema>;
export type TeamBudget = typeof teamBudgetsTable.$inferSelect;
