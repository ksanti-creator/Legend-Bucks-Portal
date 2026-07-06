import { pgTable, serial, timestamp, integer, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rewardsTable = pgTable("rewards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  buckCost: integer("buck_cost").notNull(),
  imageUrl: text("image_url"),
  quantity: integer("quantity"), // null = unlimited
  locationRestriction: text("location_restriction"),
  active: boolean("active").notNull().default(true),
  approvalRequired: boolean("approval_required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRewardSchema = createInsertSchema(rewardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReward = z.infer<typeof insertRewardSchema>;
export type Reward = typeof rewardsTable.$inferSelect;
