import type { Transaction } from "@workspace/api-client-react";
import type { TranslationParams } from "@/lib/i18n";

export type TransactionNoteRecord = Pick<Transaction,
  "type" | "note" | "amount" | "redemptionId" | "goalId" |
  "fromEmployeeId" | "toEmployeeId" | "createdById"
>;

export type TransactionNoteI18n = {
  t: (source: string, params?: TranslationParams) => string;
  number: (value: number) => string;
};

/**
 * Display-only localization of the exact templates written by the redemption,
 * goal contribution, invite, and starting-balance correction routes.
 * Never translate an award note or an arbitrary balance-adjustment note.
 * Reward/goal names and size labels are opaque interpolation values, not keys.
 */
export function formatTransactionNote(
  transaction: TransactionNoteRecord,
  { t, number }: TransactionNoteI18n,
): string | null | undefined {
  const note = transaction.note;
  if (!note) return note;

  if (transaction.type === "redemption_debit" && transaction.redemptionId != null) {
    const redemption = /^Redemption: ([\s\S]+)$/.exec(note);
    if (redemption) {
      const sized = /^([\s\S]+) \(Size ([^()]*)\)$/.exec(redemption[1]);
      return sized
        ? t("Redemption: {reward} (Size {size})", { reward: sized[1], size: sized[2] })
        : t("Redemption: {reward}", { reward: redemption[1] });
    }
  }

  if (transaction.type === "refund" && transaction.redemptionId != null) {
    if (note === `Refund for rejected redemption #${transaction.redemptionId}`) {
      return t("Refund for rejected redemption #{id}", { id: transaction.redemptionId });
    }
    if (note === `Refund for cancelled redemption #${transaction.redemptionId}`) {
      return t("Refund for cancelled redemption #{id}", { id: transaction.redemptionId });
    }
  }

  if (transaction.type === "contribution" && transaction.goalId != null) {
    const contribution = /^Contribution to goal: ([\s\S]+)$/.exec(note);
    if (contribution) return t("Contribution to goal: {goal}", { goal: contribution[1] });
  }

  if (transaction.type === "adjustment" && transaction.createdById != null &&
      transaction.redemptionId == null && transaction.goalId == null) {
    // These are the exact reserved markers the backend uses to recognize
    // invite-time starting balances and their corrections.
    if (note === "Starting balance – turned in physical bucks" &&
        transaction.toEmployeeId != null && transaction.fromEmployeeId == null) {
      return t("Starting balance – turned in physical bucks");
    }

    const correction = /^Starting balance correction: (\d+) → (\d+) bucks$/.exec(note);
    if (correction) {
      const before = Number(correction[1]);
      const after = Number(correction[2]);
      const delta = after - before;
      const matchesDirection = delta > 0
        ? transaction.toEmployeeId != null && transaction.fromEmployeeId == null
        : delta < 0 && transaction.fromEmployeeId != null && transaction.toEmployeeId == null;
      if (Number.isSafeInteger(before) && Number.isSafeInteger(after) &&
          Math.abs(delta) === transaction.amount && matchesDirection) {
        return t("Starting balance correction: {before} → {after} bucks", {
          before: number(before), after: number(after),
        });
      }
    }
  }

  return note;
}