import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Global application settings, stored as a simple key/value table so new
 * org-wide policies can be added without a schema change. Values are stored as
 * text and parsed by the caller.
 *
 * Known keys:
 *   - "max_single_award": integer, the maximum bucks allowed in a single award.
 *     Absent row = no limit.
 */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;
