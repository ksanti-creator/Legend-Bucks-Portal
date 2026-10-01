import { describe, expect, it } from "vitest";
import { sandboxEnabled } from "@workspace/db";
import { activityDescription } from "../routes/dashboard";

// Pure formatting checks: no fixtures, queries or mutations.
describe.skipIf(!sandboxEnabled())("localized authored dashboard activity", () => {
  const types = ["award", "goal_contribution", "redemption"] as const;

  it.each(types)("formats %s in French Canadian", type => {
    const description = activityDescription(type, 12500, "fr-CA");
    expect(description).toContain((12500).toLocaleString("fr-CA"));
    expect(description).not.toContain("12,500");
    expect(description).not.toContain("sent ");
    expect(description).not.toContain("redeemed ");
    expect(description).not.toContain("contributed ");
  });

  it("retains all English templates with locale-formatted amounts", () => {
    expect(activityDescription("award", 12500, "en")).toBe("sent 12,500 bucks to");
    expect(activityDescription("goal_contribution", 12500, "en")).toBe("contributed 12,500 bucks to a team goal");
    expect(activityDescription("redemption", 12500, "en")).toBe("redeemed a reward (12,500 bucks)");
  });

  it("translates sentence scaffolding only; no names or notes are accepted by the formatter", () => {
    expect(activityDescription("award", 7, "fr-CA")).toBe("a envoyé 7 Bucks à");
    expect(activityDescription("goal_contribution", 7, "fr-CA")).toBe("a contribué 7 Bucks à un objectif d’équipe");
    expect(activityDescription("redemption", 7, "fr-CA")).toBe("a échangé ses Bucks contre une récompense (7 Bucks)");
  });
});