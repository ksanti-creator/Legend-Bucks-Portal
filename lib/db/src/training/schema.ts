// Deliberately NOT exported by src/schema/index.ts: the normal database's
// migration configuration must never discover training-only tables.
export * from "../schema";
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { giftCardIssuesTable } from "../schema/giftCardIssues";

export const trainingInstallationTable = pgTable("training_installation", {
  id: integer("id").primaryKey(),
  purpose: text("purpose").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("training_installation_singleton", sql`${t.id} = 1`),
  check("training_installation_purpose", sql`${t.purpose} = 'legend-bucks-training-only'`),
  check("training_installation_version", sql`${t.schemaVersion} = 1`),
]);

export const trainingStateTable = pgTable("training_state", {
  id: integer("id").primaryKey(),
  generation: uuid("generation").notNull().defaultRandom(),
  seedVersion: integer("seed_version").notNull().default(0),
  seededAt: timestamp("seeded_at", { withTimezone: true }),
}, t => [check("training_state_singleton", sql`${t.id} = 1`)]);

export const trainingOutboxTable = pgTable("training_outbox", {
  id: serial("id").primaryKey(),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  // Only sanitized summaries, never bearer card codes or authentication URLs.
  summary: text("summary").notNull(),
  giftCardIssueId: integer("gift_card_issue_id").references(() => giftCardIssuesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainingAuditTable = pgTable("training_audit", {
  id: serial("id").primaryKey(),
  generation: uuid("generation").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
