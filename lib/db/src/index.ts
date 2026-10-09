import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { sandboxEnabled, SANDBOX_SCHEMA } from "./sandbox";
import { isTraining, trainingDatabase } from "./training/context";

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
const normalPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(sandbox ? { options: `-c search_path=${SANDBOX_SCHEMA}` } : {}),
});
const normalDb = drizzle(normalPool, { schema });
// The context is set only by the verified training transaction boundary.
// Existing handlers keep their real permissions and accounting logic.
export const db = new Proxy(normalDb, {
  get(target, property) {
    const selected = trainingDatabase() ?? target;
    const value = Reflect.get(selected, property, selected);
    return typeof value === "function" ? value.bind(selected) : value;
  },
});
export const pool = new Proxy(normalPool, {
  get(target, property) {
    if (isTraining()) throw new Error("Direct normal-pool access is forbidden in training");
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export * from "./schema";
export { sandboxEnabled, SANDBOX_SCHEMA } from "./sandbox";
export { repairSandboxRewardSizes } from "./sandbox-reward-sizes";
export { isTraining, trainingGeneration } from "./training/context";
