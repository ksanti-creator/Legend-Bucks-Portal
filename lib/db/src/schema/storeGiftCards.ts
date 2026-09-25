import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { locationsTable } from "./locations";
import { employeesTable } from "./employees";
import { giftCardIssuesTable } from "./giftCardIssues";

export const storesTable = pgTable("stores", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  locationId: integer("location_id").notNull().references(() => locationsTable.id),
  active: boolean("active").notNull().default(true),
});
export const storeAccessTable = pgTable("store_access", {
  storeId: integer("store_id").notNull().references(() => storesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
}, (t) => [uniqueIndex("store_access_employee_store").on(t.storeId, t.employeeId)]);
export const storeCardLookupTokensTable = pgTable("store_card_lookup_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  cardId: integer("card_id").notNull().references(() => giftCardIssuesTable.id),
  storeId: integer("store_id").notNull().references(() => storesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("store_card_lookup_expires").on(t.expiresAt)]);
export const storeCardLedgerTable = pgTable("store_card_ledger", {
  id: serial("id").primaryKey(),
  transactionRef: text("transaction_ref").notNull().unique(),
  cardId: integer("card_id").notNull().references(() => giftCardIssuesTable.id),
  storeId: integer("store_id").notNull().references(() => storesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  kind: text("kind").notNull(),
  amountCents: integer("amount_cents").notNull(),
  previousBalanceCents: integer("previous_balance_cents").notNull(),
  newBalanceCents: integer("new_balance_cents").notNull(),
  receiptRef: text("receipt_ref"),
  receiptNormalized: text("receipt_normalized"),
  idempotencyKey: text("idempotency_key").notNull(),
  originalSpendId: integer("original_spend_id").references((): AnyPgColumn => storeCardLedgerTable.id),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("store_card_receipt_unique").on(t.storeId, t.receiptNormalized).where(sql`${t.kind} = 'spend'`),
  uniqueIndex("store_card_idempotency_unique").on(t.employeeId, t.storeId, t.idempotencyKey),
  uniqueIndex("store_card_reversal_unique").on(t.originalSpendId).where(sql`${t.kind} = 'reversal'`),
  index("store_card_history_card").on(t.cardId),
  check("store_card_positive_amount", sql`${t.amountCents} > 0 AND ${t.previousBalanceCents} >= 0 AND ${t.newBalanceCents} >= 0`),
  check("store_card_kind_coherent", sql`(${t.kind} = 'spend' AND ${t.newBalanceCents} = ${t.previousBalanceCents} - ${t.amountCents} AND ${t.receiptNormalized} IS NOT NULL AND ${t.receiptRef} IS NOT NULL AND ${t.originalSpendId} IS NULL AND ${t.reason} IS NULL) OR (${t.kind} = 'reversal' AND ${t.newBalanceCents} = ${t.previousBalanceCents} + ${t.amountCents} AND ${t.receiptRef} IS NULL AND ${t.receiptNormalized} IS NULL AND ${t.originalSpendId} IS NOT NULL AND ${t.reason} IS NOT NULL)`),
]);