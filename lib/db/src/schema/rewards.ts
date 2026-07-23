import { pgTable, serial, timestamp, integer, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rewardsTable = pgTable("rewards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  buckCost: integer("buck_cost").notNull(),
  cadValueCents: integer("cad_value_cents"), // real-money value in CAD cents; null = not set. Accounting-only.
  productCode: text("product_code"), // internal SKU / product code; null = not set. Admin-only.
  serialNumber: text("serial_number"), // internal serial number; null = not set. Admin-only.
  imageUrl: text("image_url"),
  // Ordered list of photo URLs; first entry is the cover image. imageUrl is
  // kept in sync with imageUrls[0] for backward compatibility.
  imageUrls: text("image_urls").array().notNull().default([]),
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
