import { pgTable, serial, timestamp, integer, text, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { redemptionsTable } from "./redemptions";
import { employeesTable } from "./employees";

export const giftCardIssueStatusEnum = pgEnum("gift_card_issue_status", [
  "pending_issue",
  "emailed",
  "email_failed",
  "voided",
  "reissued",
]);

export const giftCardIssuesTable = pgTable("gift_card_issues", {
  id: serial("id").primaryKey(),
  redemptionId: integer("redemption_id").notNull().references(() => redemptionsTable.id),
  codeHash: text("code_hash").notNull().unique(),
  codeLast4: text("code_last4").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  lbAmount: integer("lb_amount").notNull(),
  cadValueCents: integer("cad_value_cents").notNull(),
  status: giftCardIssueStatusEnum("status").notNull().default("pending_issue"),
  issuedByEmployeeId: integer("issued_by_employee_id").notNull().references(() => employeesTable.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  replacementIssueId: integer("replacement_issue_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("gift_card_issues_one_current_per_redemption")
    .on(table.redemptionId)
    .where(sql`${table.status} NOT IN ('voided', 'reissued')`),
]);