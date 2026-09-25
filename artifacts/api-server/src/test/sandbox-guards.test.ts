import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { pool, sandboxEnabled } from "@workspace/db";
import storageRouter from "../routes/storage";
import { sendMagicLinkEmail } from "../lib/email";

afterEach(() => vi.unstubAllEnvs());

describe("sandbox safety gates", () => {
  it.skipIf(!sandboxEnabled())("isolates the active database search path and serial defaults", async () => {
    const path = await pool.query("SHOW search_path");
    expect(path.rows[0].search_path).toBe("legend_bucks_sandbox");
    const schemas = await pool.query("SELECT current_schemas(false)::text AS schemas");
    expect(schemas.rows[0].schemas).toBe("{legend_bucks_sandbox}");
    const externalSequences = await pool.query(
      `SELECT count(*)::int AS count FROM pg_attrdef d
       JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid
       JOIN pg_class seq ON seq.oid=dep.refobjid AND seq.relkind='S'
       JOIN pg_namespace sn ON sn.oid=seq.relnamespace
       WHERE n.nspname='legend_bucks_sandbox' AND sn.nspname<>'legend_bucks_sandbox'`,
    );
    expect(externalSequences.rows[0].count).toBe(0);
    const fks = await pool.query(
      `SELECT count(*)::int AS count FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=k.confrelid
       JOIN pg_namespace pn ON pn.oid=p.relnamespace
       WHERE k.contype='f' AND n.nspname='legend_bucks_sandbox' AND pn.nspname<>'legend_bucks_sandbox'`,
    );
    expect(fks.rows[0].count).toBe(0);
  });

  it("refuses a sandbox flag outside development", () => {
    expect(() => sandboxEnabled({ NODE_ENV: "production", LEGEND_BUCKS_SANDBOX: "true" })).toThrow();
    expect(() => sandboxEnabled({ LEGEND_BUCKS_SANDBOX: "true" })).toThrow();
    expect(sandboxEnabled({ NODE_ENV: "development", LEGEND_BUCKS_SANDBOX: "true" })).toBe(true);
    expect(sandboxEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it("never reaches storage for public or private asset reads and writes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LEGEND_BUCKS_SANDBOX", "true");
    const app = express();
    app.use(storageRouter);
    for (const path of ["/storage/public-objects/logo.png", "/storage/objects/uploads/a"]) {
      expect((await request(app).get(path)).status).toBe(403);
    }
    expect((await request(app).post("/storage/uploads/request-url")).status).toBe(403);
  });

  it("simulates mail without logging a token, address or message", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LEGEND_BUCKS_SANDBOX", "true");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await sendMagicLinkEmail("preview.employee@example.test", "Sam", "private-token-123");
      expect(log).toHaveBeenCalledOnce();
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).not.toContain("private-token-123");
      expect(logged).not.toContain("preview.employee@example.test");
    } finally {
      log.mockRestore();
    }
  });
});