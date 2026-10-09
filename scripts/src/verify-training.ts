import { verifyTrainingDatabase } from "@workspace/db/training-preflight";

const result = await verifyTrainingDatabase();
// The verifier exposes only safe metadata and fixed messages, never credentials.
console.info(JSON.stringify(result, null, 2));
if (!result.connected || !result.restricted || !result.initialized) {
  process.exitCode = 1;
}
