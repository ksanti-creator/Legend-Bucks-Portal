import type { PoolClient } from "pg";
import { sandboxEnabled, SANDBOX_SCHEMA } from "./sandbox";

/**
 * Manual sandbox maintenance only; never called by application startup.
 * LIKE INCLUDING ALL omits foreign keys, including reward size deletion.
 */
export async function repairSandboxRewardSizes(client: PoolClient): Promise<{ orphanRows: number }> {
  if (!sandboxEnabled()) throw new Error("Reward-size repair requires the development sandbox");
  const path = await client.query("SHOW search_path");
  const schemas = await client.query("SELECT current_schemas(false)::text AS schemas");
  if (path.rows[0].search_path !== SANDBOX_SCHEMA || schemas.rows[0].schemas !== `{${SANDBOX_SCHEMA}}`) {
    throw new Error("Reward-size repair requires an isolated sandbox search_path");
  }

  const name = "reward_sizes_reward_id_rewards_id_fk";
  const existing = await client.query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
     WHERE conrelid='legend_bucks_sandbox.reward_sizes'::regclass AND conname=$1`,
    [name],
  );
  if (existing.rowCount) {
    // Fail rather than replace a conflicting constraint or touch public tables.
    const definition = existing.rows[0].definition.replace(/ NOT VALID$/, "");
    if (definition !== "FOREIGN KEY (reward_id) REFERENCES rewards(id) ON DELETE CASCADE") {
      throw new Error("Unexpected sandbox reward-size constraint");
    }
  } else {
    // Old sandbox runs left orphans. NOT VALID preserves those unowned rows,
    // while enforcing new writes and cascading deletes of existing parents.
    await client.query(
      `ALTER TABLE legend_bucks_sandbox.reward_sizes
       ADD CONSTRAINT reward_sizes_reward_id_rewards_id_fk
       FOREIGN KEY (reward_id) REFERENCES legend_bucks_sandbox.rewards(id)
       ON DELETE CASCADE NOT VALID`,
    );
  }
  const orphans = await client.query(
    `SELECT count(*)::int AS count FROM legend_bucks_sandbox.reward_sizes s
     LEFT JOIN legend_bucks_sandbox.rewards r ON r.id=s.reward_id WHERE r.id IS NULL`,
  );
  const orphanRows: number = orphans.rows[0].count;
  if (orphanRows === 0) {
    await client.query(
      `ALTER TABLE legend_bucks_sandbox.reward_sizes
       VALIDATE CONSTRAINT reward_sizes_reward_id_rewards_id_fk`,
    );
  }
  return { orphanRows };
}