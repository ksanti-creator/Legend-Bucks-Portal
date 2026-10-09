/**
 * Generate an owner-run, EMPTY-training-database-only setup script.
 * No database client is imported and no connection is opened by this generator.
 * Never register its output as a live migration or startup command.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "legend-training-schema-"));
try {
  const generated = spawnSync("pnpm", [
    "--filter", "@workspace/db", "exec", "drizzle-kit", "generate",
    "--dialect=postgresql",
    `--schema=${join(root, "lib/db/src/training/schema.ts")}`,
    `--out=${temporary}`,
  ], { cwd: root, encoding: "utf8" });
  if (generated.status !== 0) {
    throw new Error("Offline schema generation failed. No database was contacted.");
  }
  const files = (await readdir(temporary)).filter(name => name.endsWith(".sql"));
  if (files.length !== 1) throw new Error("Expected exactly one fresh schema definition.");
  const schema = (await readFile(join(temporary, files[0]), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
  if (/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|COPY)\b/i.test(
    schema.replace(/ON DELETE (?:no action|cascade|restrict|set null|set default)/gi, "")
      .replace(/ON UPDATE (?:no action|cascade|restrict|set null|set default)/gi, ""),
  )) throw new Error("Generated schema contains an unexpected data-changing operation.");

  const sql = `-- OWNER ACTION: run only in the NEW, EMPTY legend_bucks_training database.
-- This creates structure from source code. It does not copy any live data.
-- Do not register this file with live migrations, publish hooks or app startup.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SELECT pg_advisory_xact_lock(768135091);
DO $guard$
BEGIN
  IF current_database() <> 'legend_bucks_training'
     OR current_user <> 'legend_bucks_training_owner' THEN
    RAISE EXCEPTION 'Refusing setup: wrong database or owner.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  ) THEN
    RAISE EXCEPTION 'Refusing setup: database is not empty. Nothing will be erased.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'legend_training_app' AND rolcanlogin
      AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR pg_has_role('legend_training_app', 'neon_superuser', 'MEMBER') THEN
    RAISE EXCEPTION 'Refusing setup: restricted training login is missing or elevated.';
  END IF;
END
$guard$;

${schema}

INSERT INTO public.training_installation (id, purpose, schema_version)
VALUES (1, 'legend-bucks-training-only', 1);
INSERT INTO public.training_state (id) VALUES (1);

REVOKE ALL ON DATABASE legend_bucks_training FROM PUBLIC;
GRANT CONNECT ON DATABASE legend_bucks_training TO legend_training_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO legend_training_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO legend_training_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO legend_training_app;
REVOKE INSERT, UPDATE, DELETE ON public.training_installation FROM legend_training_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO legend_training_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO legend_training_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
`;
  const output = join(root, "docs", "training");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "initialize-training.sql"), sql);
  const escaped = sql.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  await writeFile(join(output, "owner-setup.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Legend Bucks — training database setup</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#163040}h1{line-height:1.2}
.notice{background:#fff4d5;border:1px solid #cfad4e;padding:18px;border-radius:10px}button{font:inherit;background:#075985;color:white;border:0;border-radius:8px;padding:12px 22px;cursor:pointer}pre{background:#f1f5f9;padding:20px;overflow:auto;font-size:13px}li{margin:10px 0}</style>
<h1>Initialize the empty training database</h1>
<p class="notice"><strong>Training only.</strong> This does not enable /training. No live data is copied.
The script stops if the database name or owner is wrong, or if any user table already exists.
It creates the current application tables plus training-only state, outbox, audit, and installation tables,
but no employees, cards, or transactions.</p>
<ol><li>In Neon, select your confirmed <strong>Legend Bucks Training</strong> project.</li>
<li>Open <strong>SQL Editor</strong>. Select database <strong>legend_bucks_training</strong> and role <strong>legend_bucks_training_owner</strong>.</li>
<li>Copy the complete script below, paste it into the editor, and run it once.</li>
<li>Tell Replit Agent <strong>“Training tables created”</strong>, or share the error message without credentials.</li></ol>
<p>Keep Replit’s TRAINING_DATABASE_URL set to <strong>legend_training_app</strong>. Do not replace it with the owner connection.
Do not change DATABASE_URL, run Neon link/deploy/MCP, or enable training.</p>
<button id="copy" type="button">Copy complete setup script</button><span id="result" role="status"></span>
<pre id="sql">${escaped}</pre>
<script>document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById('sql').textContent);document.getElementById('result').textContent=' Copied.'}catch{const range=document.createRange();range.selectNodeContents(document.getElementById('sql'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.getElementById('result').textContent=' Script selected. Use Copy on your device.'}};</script>
</html>`);
  console.info("Generated docs/training/initialize-training.sql and owner-setup.html. No database connection was opened.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
