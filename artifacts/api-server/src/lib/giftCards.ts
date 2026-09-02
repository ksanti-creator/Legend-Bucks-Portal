import crypto from "node:crypto";
import QRCode from "qrcode";
import { sendGiftCardRecipientEmail } from "./email";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Seven groups of four base-32 characters retain 140 bits of entropy.
 * Four groups would hold only 80 bits, so the longer grouped format is
 * required for a bearer-value credential while remaining easy to transcribe.
 */
export function generateGiftCardCode(): string {
  const chars: string[] = [];
  while (chars.length < 28) {
    for (const byte of crypto.randomBytes(32)) {
      if (byte >= 224) continue;
      chars.push(ALPHABET[byte % ALPHABET.length]);
      if (chars.length === 28) break;
    }
  }
  const groups = Array.from({ length: 7 }, (_, index) =>
    chars.slice(index * 4, index * 4 + 4).join(""),
  );
  return `LBGC-${groups.join("-")}`;
}

export function hashGiftCardCode(code: string): string {
  return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

export function maskGiftCardCode(last4: string): string {
  return `LBGC-••••-••••-••••-••••-••••-••••-${last4}`;
}

export function lbToCadCents(lbAmount: number): number {
  return lbAmount * 10;
}

export function validateGiftCardLbAmount(
  amount: number,
  increment: number,
  minimum: number,
  maximum: number | null,
  availableBalance: number,
): string | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return "Amount must be a whole positive number";
  if (amount < minimum) return `Amount must be at least ${minimum} LB`;
  if (amount % increment !== 0) return `Amount must be a multiple of ${increment} LB`;
  if (maximum !== null && amount > maximum) return `Amount cannot exceed ${maximum} LB`;
  if (amount > availableBalance) return "Insufficient balance";
  return null;
}

export async function emailGiftCard(input: {
  recipientEmail: string;
  recipientName: string;
  code: string;
  cadValueCents: number;
  message: string | null;
}): Promise<void> {
  const qrDataUrl = await QRCode.toDataURL(input.code, { errorCorrectionLevel: "M", margin: 1, width: 240 });
  await sendGiftCardRecipientEmail(
    input.recipientEmail,
    input.recipientName,
    input.code,
    input.cadValueCents,
    qrDataUrl,
    input.message,
  );
}