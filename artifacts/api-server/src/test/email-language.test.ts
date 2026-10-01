import { beforeEach, describe, expect, it, vi } from "vitest";

const { proxy } = vi.hoisted(() => ({
  proxy: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "test-only" }) }),
}));
vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class { proxy = proxy; },
}));
// Render through the actual MIME path, but its sole external boundary is mocked.
// The real environment guard below still restricts this suite to sandbox.
vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  sandboxEnabled: () => false,
}));
const realDb = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
import * as email from "../lib/email";
import type { PreferredLanguage } from "../lib/email";

const address = "test-only@example.test";
const name = "Élodie <script>alert(1)</script>";
const reward = 'Reward <b>user text</b> & "quoted"';
const note = "Cost is user-entered English <img src=x>";
const date = new Date("2026-01-15T12:00:00Z");

const cases: { name: string; en: string; fr: string; send: (language: PreferredLanguage) => Promise<void> }[] = [
  { name: "magic link", en: "Your Legend Bucks sign-in link", fr: "Votre lien de connexion",
    send: l => email.sendMagicLinkEmail(address, name, "token<unsafe>", l) },
  { name: "invite", en: "invited you to Legend Bucks", fr: "vous invite à Legend Bucks",
    send: l => email.sendInviteEmail(address, name, "Zoé <admin>", "token<unsafe>", l) },
  { name: "bucks received", en: "You received", fr: "Vous avez reçu",
    send: l => email.sendBucksReceivedEmail(address, name, "Zoé <admin>", 12500, note, l) },
  { name: "receipt", en: "Redemption receipt:", fr: "Reçu d’échange",
    send: l => email.sendRedemptionReceiptEmail(address, name, reward, 12500, date, "requested",
      { cadValueCents: 125000, recipientName: name, recipientEmail: address, message: note }, l) },
  { name: "new request", en: "New redemption request:", fr: "Nouvelle demande d’échange",
    send: l => email.sendNewRedemptionRequestEmail(address, name, "Zoé <admin>", reward, 12500, note, "<XL>", l) },
  { name: "fixed payroll", en: "Time Off in Lieu:", fr: "Congé compensatoire",
    send: l => email.sendTimeOffPayrollEmail(name, address, reward, note, 1234, l) },
  { name: "time off approved", en: "Manager approved", fr: "Approuvé par le gestionnaire",
    send: l => email.sendTimeOffApprovedEmail(address, name, reward, l) },
  { name: "payroll approver", en: "Payroll sign-off needed:", fr: "Approbation de la paie requise",
    send: l => email.sendPayrollApprovalNeededEmail(address, name, "Zoé <admin>", reward, 12500, l) },
  { name: "approved", en: "Approved:", fr: "Approuvée",
    send: l => email.sendRedemptionApprovedEmail(address, name, reward, l) },
  { name: "rejected", en: "Update on your redemption:", fr: "Mise à jour de votre demande",
    send: l => email.sendRedemptionRejectedEmail(address, name, reward, 12500, note, l) },
  { name: "fulfilled", en: "On its way:", fr: "En route",
    send: l => email.sendRedemptionFulfilledEmail(address, name, reward, l) },
  { name: "gift card", en: "Your Legend Boats Gift Card is ready", fr: "Votre carte-cadeau Legend Boats est prête",
    send: l => email.sendGiftCardRecipientEmail(address, name, "LBGC-TEST-<1234>", 125000, "data:image/png;base64,test", "/safe-image.png", l) },
];

function sentMessage(): { subject: string; html: string; mime: string } {
  const body = JSON.parse(proxy.mock.calls.at(-1)![2].body) as { raw: string };
  const mime = Buffer.from(body.raw, "base64url").toString("utf8");
  const header = /^Subject: (.*)\r$/m.exec(mime)![1];
  const encoded = /^=\?UTF-8\?B\?(.+)\?=$/.exec(header);
  return {
    subject: encoded ? Buffer.from(encoded[1], "base64").toString("utf8") : header,
    html: mime.split("\r\n\r\n")[1], mime,
  };
}

describe.skipIf(!realDb.sandboxEnabled())("all 12 bilingual transactional templates (mock transport)", () => {
  beforeEach(() => proxy.mockClear());

  for (const language of ["en", "fr-CA"] as const) {
    it.each(cases)(`${language}: $name has translated subject, shell and escaped user content`, async item => {
      await item.send(language);
      expect(proxy).toHaveBeenCalledOnce();
      const { subject, html, mime } = sentMessage();
      expect(subject).toContain(language === "fr-CA" ? item.fr : item.en);
      expect(html).toContain(`<html lang="${language}">`);
      expect(html).toContain(language === "fr-CA" ? "Usage interne seulement." : "Internal use only.");
      expect(html).toContain("Élodie &lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img src=x>");
      expect(mime).toContain('charset="UTF-8"');
      if (language === "fr-CA") {
        expect(html).not.toContain("Hi ");
        expect(html).not.toContain("Sign in to Legend Bucks to");
        expect(html).not.toContain("Your redemption");
      }
    });
  }

  it("audits exactly the complete exported email template inventory", () => {
    expect(cases).toHaveLength(12);
    expect(Object.keys(email).filter(key => /^send.*Email$/.test(key))).toHaveLength(12);
  });

  it("uses French Canadian bucks, CAD, dates and status without translating notes", async () => {
    await cases.find(c => c.name === "receipt")!.send("fr-CA");
    const { html } = sentMessage();
    expect(html).toContain(`${(12500).toLocaleString("fr-CA")} LB`);
    expect(html).toContain(new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", currencyDisplay: "code" }).format(1250));
    expect(html).toContain(date.toLocaleDateString("fr-CA", { month: "long", day: "numeric", year: "numeric" }));
    expect(html).toContain("Demandée");
    expect(html).toContain("Cost is user-entered English &lt;img src=x&gt;");
  });

  it("retains payroll warnings and does not leak CAD into approver mail", async () => {
    await cases.find(c => c.name === "time off approved")!.send("fr-CA");
    expect(sentMessage().html).toContain("ne confirme pas que votre solde dans BambooHR est prêt");
    expect(sentMessage().html).toContain("ne réserve aucune date");
    await cases.find(c => c.name === "payroll approver")!.send("fr-CA");
    expect(sentMessage().html).not.toContain("CAD");
    await cases.find(c => c.name === "new request")!.send("fr-CA");
    expect(sentMessage().html).not.toContain("CAD");
  });

  it("retains single-use expiry and escapes auth tokens", async () => {
    await cases[0].send("fr-CA");
    expect(sentMessage().html).toContain("15 minutes");
    expect(sentMessage().html).toContain("une seule fois");
    expect(sentMessage().html).toContain("token&lt;unsafe&gt;");
    expect(sentMessage().html).toContain("token%3Cunsafe%3E");
  });
});