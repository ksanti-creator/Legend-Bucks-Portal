import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, employeesTable, magicTokensTable, sessionsTable, pool, sandboxEnabled } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { Fixtures, bearer, uniq } from "./helpers";

vi.mock("../lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/email")>(),
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
  sendGiftCardRecipientEmail: vi.fn().mockResolvedValue(undefined),
}));
import app from "../app";
import { sendMagicLinkEmail, sendGiftCardRecipientEmail } from "../lib/email";
import { emailGiftCard } from "../lib/giftCards";

// Hooks are inside the guarded suite: an ordinary/prod invocation cannot create
// or delete fixtures. Assert the isolated pool before the first write.
describe.skipIf(!sandboxEnabled())("self-scoped saved language (sandbox only)", () => {
  const fx = new Fixtures();
  const users: Awaited<ReturnType<Fixtures["createAuthedEmployee"]>>[] = [];

  beforeAll(async () => {
    const path = await pool.query("SHOW search_path");
    expect(path.rows[0].search_path).toBe("legend_bucks_sandbox");
    for (const role of ["team_member", "manager", "admin", "accounting_admin"] as const) {
      users.push(await fx.createAuthedEmployee(role));
    }
  });
  afterAll(async () => {
    if (fx.employeeIds.length) {
      // Verification creates sessions not minted by Fixtures. Delete only rows
      // attached to the employees this suite owns.
      await db.delete(magicTokensTable).where(inArray(magicTokensTable.employeeId, fx.employeeIds));
      await db.delete(sessionsTable).where(inArray(sessionsTable.employeeId, fx.employeeIds));
    }
    await fx.cleanup();
  });

  it("defaults new employees to en and exposes it in /me and employee responses", async () => {
    for (const { emp, token } of users) {
      expect(emp.preferredLanguage).toBe("en");
      expect((await request(app).get("/api/auth/me").set(bearer(token))).body.preferredLanguage).toBe("en");
      expect((await request(app).get(`/api/employees/${emp.id}`).set(bearer(token))).body.preferredLanguage).toBe("en");
    }
  });

  it("allows every authenticated role to save only their own strict enum preference", async () => {
    for (const { emp, token } of users) {
      const res = await request(app).patch("/api/auth/me/preferences").set(bearer(token)).send({ preferredLanguage: "fr-CA" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ preferredLanguage: "fr-CA" });
      const [saved] = await db.select().from(employeesTable).where(eq(employeesTable.id, emp.id));
      expect(saved.preferredLanguage).toBe("fr-CA");
      expect((await request(app).get("/api/auth/me").set(bearer(token))).body.preferredLanguage).toBe("fr-CA");
    }
  });

  it("rejects missing, coerced, unsupported and extra fields without changing another employee", async () => {
    const { token } = users[0];
    for (const body of [
      {}, { preferredLanguage: "fr" }, { preferredLanguage: "fr-ca" }, { preferredLanguage: "en-US" },
      { preferredLanguage: null }, { preferredLanguage: 1 }, { preferredLanguage: ["en"] },
      { preferredLanguage: "en", employeeId: users[1].emp.id }, { preferredLanguage: "en", id: users[1].emp.id },
    ]) {
      expect((await request(app).patch("/api/auth/me/preferences").set(bearer(token)).send(body)).status).toBe(400);
    }
    expect((await request(app).patch("/api/auth/me/preferences").send({ preferredLanguage: "en" })).status).toBe(401);
    // Even an injected query target cannot alter a foreign employee.
    expect((await request(app).patch(`/api/auth/me/preferences?id=${users[1].emp.id}`)
      .set(bearer(token)).send({ preferredLanguage: "en" })).status).toBe(200);
    const [other] = await db.select().from(employeesTable).where(eq(employeesTable.id, users[1].emp.id));
    expect(other.preferredLanguage).toBe("fr-CA");
  });

  it("uses selected prelogin language but saves it only after ownership is verified", async () => {
    const { emp } = users[0];
    vi.mocked(sendMagicLinkEmail).mockClear();
    const login = await request(app).post("/api/auth/login").send({ email: emp.email, preferredLanguage: "fr-CA" });
    expect(login.status).toBe(200);
    expect(sendMagicLinkEmail).toHaveBeenCalledWith(emp.email, emp.firstName, login.body.token, "fr-CA");
    const [beforeVerify] = await db.select().from(employeesTable).where(eq(employeesTable.id, emp.id));
    expect(beforeVerify.preferredLanguage).toBe("en");
    const verified = await request(app).post("/api/auth/verify").send({ token: login.body.token });
    expect(verified.status).toBe(200);
    expect(verified.body.preferredLanguage).toBe("fr-CA");
    expect((await request(app).get("/api/auth/me").set(bearer(verified.body.token))).body.preferredLanguage).toBe("fr-CA");
    expect((await request(app).post("/api/auth/verify").send({ token: login.body.token })).status).toBe(400);
    expect((await request(app).post("/api/auth/login").send({ email: emp.email, preferredLanguage: "fr" })).status).toBe(400);
  });

  it("omitted login language uses and preserves the saved employee choice", async () => {
    const { emp } = users[0];
    const login = await request(app).post("/api/auth/login").send({ email: emp.email });
    expect(sendMagicLinkEmail).toHaveBeenCalledWith(emp.email, emp.firstName, login.body.token, "fr-CA");
    const verified = await request(app).post("/api/auth/verify").send({ token: login.body.token });
    expect(verified.status).toBe(200);
    expect(verified.body.preferredLanguage).toBe("fr-CA");
  });

  it("gift card employee recipients use their preference; external recipients inherit the purchaser's", async () => {
    vi.mocked(sendGiftCardRecipientEmail).mockClear();
    const input = {
      recipientName: "Preserved Name", code: "LBGC-TEST-ONLY", cadValueCents: 1000, catalogImageUrl: null,
      purchaserPreferredLanguage: "en" as const,
    };
    await emailGiftCard({ ...input, recipientEmail: users[1].emp.email.toUpperCase() });
    expect(vi.mocked(sendGiftCardRecipientEmail).mock.calls.at(-1)![6]).toBe("fr-CA");
    await emailGiftCard({ ...input, recipientEmail: `${uniq("external")}@example.test`, purchaserPreferredLanguage: "fr-CA" });
    expect(vi.mocked(sendGiftCardRecipientEmail).mock.calls.at(-1)![6]).toBe("fr-CA");
    await emailGiftCard({ ...input, recipientEmail: `${uniq("external")}@example.test` });
    expect(vi.mocked(sendGiftCardRecipientEmail).mock.calls.at(-1)![6]).toBe("en");
  });
});