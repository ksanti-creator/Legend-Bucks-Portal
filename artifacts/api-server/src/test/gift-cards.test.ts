import { describe, expect, it } from "vitest";
import {
  generateGiftCardCode,
  hashGiftCardCode,
  lbToCadCents,
  maskGiftCardCode,
  validateGiftCardLbAmount,
} from "../lib/giftCards";

describe("gift card security and conversion", () => {
  it("converts LB to CAD cents exactly", () => {
    expect(lbToCadCents(100)).toBe(1_000);
    expect(lbToCadCents(1_250)).toBe(12_500);
  });

  it("generates unique formatted codes with no ambiguous characters", () => {
    const codes = new Set(Array.from({ length: 1_000 }, generateGiftCardCode));
    expect(codes.size).toBe(1_000);
    for (const code of codes) expect(code).toMatch(/^LBGC-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){6}$/);
  });

  it("hashes rather than exposing a full code in a masked representation", () => {
    const code = generateGiftCardCode();
    const hash = hashGiftCardCode(code);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(code);
    expect(maskGiftCardCode(code.slice(-4))).toBe(`LBGC-••••-••••-••••-••••-••••-••••-${code.slice(-4)}`);
  });

  it("enforces default 100-LB increments independently of conversion", () => {
    expect(validateGiftCardLbAmount(100, 100, 100, null, 2_000)).toBeNull();
    expect(validateGiftCardLbAmount(99, 100, 100, null, 2_000)).not.toBeNull();
    expect(validateGiftCardLbAmount(125, 100, 100, null, 2_000)).not.toBeNull();
    expect(validateGiftCardLbAmount(-100, 100, 100, null, 2_000)).not.toBeNull();
    expect(validateGiftCardLbAmount(2_100, 100, 100, null, 2_000)).toBe("Insufficient balance");
  });

  it("allows the 1,250 LB conversion when configured with a compatible increment", () => {
    expect(validateGiftCardLbAmount(1_250, 50, 100, 2_000, 2_000)).toBeNull();
  });
});