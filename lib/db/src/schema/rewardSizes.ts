import { pgTable, serial, integer, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { rewardsTable } from "./rewards";

/**
 * Size variants for sized rewards (shirts, hoodies, boots...). A reward with
 * one or more size rows is "sized": redemptions must pick a size and stock is
 * tracked per size. Rewards with no size rows keep the pooled quantity on the
 * rewards table.
 */
export const rewardSizesTable = pgTable("reward_sizes", {
  id: serial("id").primaryKey(),
  rewardId: integer("reward_id")
    .notNull()
    .references(() => rewardsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(), // e.g. "S", "M", "XL", "Size 10"
  quantity: integer("quantity"), // null = unlimited for this size
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  // Stock decrement/restore match by (reward_id, label); duplicates would let
  // one redemption move stock on multiple rows.
  uniqueIndex("reward_sizes_reward_id_label_unique").on(t.rewardId, t.label),
]);

export const insertRewardSizeSchema = createInsertSchema(rewardSizesTable).omit({ id: true });
export type InsertRewardSize = z.infer<typeof insertRewardSizeSchema>;
export type RewardSize = typeof rewardSizesTable.$inferSelect;
