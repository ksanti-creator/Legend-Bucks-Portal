/** The preview is never available in a production process, even with a misconfigured flag. */
export function sandboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LEGEND_BUCKS_SANDBOX === "true" && env.NODE_ENV !== "development") {
    throw new Error("LEGEND_BUCKS_SANDBOX requires NODE_ENV=development");
  }
  return env.LEGEND_BUCKS_SANDBOX === "true" && env.NODE_ENV === "development";
}

export const SANDBOX_SCHEMA = "legend_bucks_sandbox";