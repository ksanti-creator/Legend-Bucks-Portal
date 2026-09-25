import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { sandboxEnabled, SANDBOX_SCHEMA } from "./sandbox";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const sandbox = sandboxEnabled();
// libpq options on the URL could override the enforced search_path.
if (sandbox && new URL(process.env.DATABASE_URL).searchParams.has("options")) {
  throw new Error("DATABASE_URL options are not permitted in sandbox mode");
}
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(sandbox ? { options: `-c search_path=${SANDBOX_SCHEMA}` } : {}),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { sandboxEnabled, SANDBOX_SCHEMA } from "./sandbox";
