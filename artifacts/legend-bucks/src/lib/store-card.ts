// Shared helpers for the in-store gift card tool.
// Never store or log full card codes. Only non-secret pending data is persisted.

const DOLLARS_RE = /^(\d{1,6})(?:\.(\d{1,2}))?$/;

/** Parse a decimal dollar string into integer cents exactly. Returns null if invalid or non-positive. */
export function dollarsToCents(input: string): number | null {
  const m = DOLLARS_RE.exec(input.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

export function formatCad(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

export function apiErrorInfo(err: unknown): { status?: number; message: string } {
  const e = err as { status?: number; data?: { error?: unknown } } | null;
  const raw = e?.data && typeof e.data.error === "string" ? e.data.error : undefined;
  return { status: typeof e?.status === "number" ? e.status : undefined, message: raw ?? "" };
}

/** A request is "uncertain" when we never got an HTTP response (timeout / network) or the server errored. */
export function isUncertain(err: unknown): boolean {
  const { status } = apiErrorInfo(err);
  return status === undefined || status >= 500;
}

export type PendingSpend = {
  storeId: number;
  cardId: number;
  /** Opaque 30-minute checkout capability (not the card code). */
  lookupToken: string;
  maskedCode: string;
  balanceCents: number;
  amountCents: number;
  receiptRef: string;
  idempotencyKey: string;
  uncertain: boolean;
};

const SPEND_KEY = "lb.storeCard.pendingSpend";

export function loadPendingSpend(): PendingSpend | null {
  try {
    const raw = sessionStorage.getItem(SPEND_KEY);
    return raw ? (JSON.parse(raw) as PendingSpend) : null;
  } catch {
    return null;
  }
}
export function savePendingSpend(p: PendingSpend) {
  sessionStorage.setItem(SPEND_KEY, JSON.stringify(p));
}
export function clearPendingSpend() {
  sessionStorage.removeItem(SPEND_KEY);
}

export type PendingReversal = { transactionRef: string; reason: string; idempotencyKey: string; uncertain: boolean };
const REV_KEY = "lb.storeCard.pendingReversal";
export function loadPendingReversal(): PendingReversal | null {
  try {
    const raw = sessionStorage.getItem(REV_KEY);
    return raw ? (JSON.parse(raw) as PendingReversal) : null;
  } catch {
    return null;
  }
}
export function savePendingReversal(p: PendingReversal) {
  sessionStorage.setItem(REV_KEY, JSON.stringify(p));
}
export function clearPendingReversal() {
  sessionStorage.removeItem(REV_KEY);
}
