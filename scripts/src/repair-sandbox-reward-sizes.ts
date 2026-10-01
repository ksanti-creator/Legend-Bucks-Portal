import { pool, repairSandboxRewardSizes, sandboxEnabled } from "@workspace/db";

// Manual and schema-only: no seed, data deletion, public DDL or production use.
if (!sandboxEnabled()) throw new Error("Reward-size repair requires the development sandbox");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await repairSandboxRewardSizes(client);
  await client.query("COMMIT");
  console.log(`Sandbox reward-size cascade installed; ${result.orphanRows} existing orphan rows preserved.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}