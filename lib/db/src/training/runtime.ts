import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { inTrainingContext } from "./context";
import { verifyTrainingDatabase } from "./verify";

let pool: pg.Pool | undefined;
const RESET_LOCK = 768135092;

/** Every request shares a transaction-scoped lock; reset takes it exclusively.
 * Nested domain transactions become savepoints on this same connection.
 * No session-scoped settings or locks: Neon may use transaction pooling.
 */
export async function withTrainingTransaction<T>(
  action: () => Promise<T>,
  options: { exclusive?: boolean; requireSeed?: boolean } = {},
): Promise<T> {
  if (process.env.TRAINING_MODE_ENABLED !== "true") throw new Error("Training is disabled");
  const verified = await verifyTrainingDatabase();
  if (!verified.connected || !verified.restricted || !verified.initialized) {
    throw new Error("Training isolation verification failed");
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.TRAINING_DATABASE_URL,
      max: 8, connectionTimeoutMillis: 12_000,
      statement_timeout: 30_000, idleTimeoutMillis: 10_000,
      application_name: "legend_bucks_training_only",
    });
    pool.on("error", () => { /* Never disclose connection errors or credentials. */ });
  }
  return drizzle(pool, { schema }).transaction(async tx => {
    await tx.execute(sql`SET LOCAL search_path = public, pg_catalog`);
    await tx.execute(options.exclusive
      ? sql`SELECT pg_advisory_xact_lock(${RESET_LOCK})`
      : sql`SELECT pg_advisory_xact_lock_shared(${RESET_LOCK})`);
    const [state] = await tx.select().from(schema.trainingStateTable).limit(1);
    if (!state || (options.requireSeed !== false && state.seedVersion !== 1)) {
      throw new Error("Training seed is missing");
    }
    return inTrainingContext(tx, state.generation, action);
  });
}

export async function closeTrainingPool() {
  const previous = pool;
  pool = undefined;
  await previous?.end();
}
