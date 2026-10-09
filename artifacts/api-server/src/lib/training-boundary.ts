import type { RequestHandler, Router } from "express";
import { withTrainingTransaction } from "@workspace/db/training-runtime";

// Explicit route list: adding a new live endpoint does not implicitly make it
// callable in training. Storage, integrations, login/verify and unknown paths
// are deliberately absent.
const allowed: Record<string, RegExp[]> = {
  GET: [
    /^\/auth\/me$/, /^\/(departments|locations|employees|rewards|goals|redemptions|transactions|settings)$/,
    /^\/employees\/\d+(\/(award-budget|balance|starting-balance))?$/,
    /^\/(rewards|goals|redemptions|transactions)\/\d+$/,
    /^\/goals\/\d+\/contributions$/, /^\/(transactions|redemptions)\/export$/,
    /^\/transactions\/summary$/, /^\/dashboard\/(summary|activity|leaderboard)$/,
    /^\/stores(\/access)?$/, /^\/store-gift-cards\/(status|my-stores|transactions)$/,
    /^\/training\/(outbox|cards)$/,
  ],
  POST: [
    /^\/auth\/(invite|bulk-invite|logout)$/, /^\/(departments|locations|rewards|goals|redemptions|transactions|stores)$/,
    /^\/(departments|locations)\/\d+\/reassign$/, /^\/goals\/\d+\/contribute$/,
    /^\/transactions\/(adjustments|starting-balance-corrections)$/,
    /^\/redemptions\/\d+\/gift-card\/(issue|reissue|void)$/,
    /^\/stores\/access$/, /^\/store-gift-cards\/(lookup|spend|reverse)$/,
  ],
  PATCH: [
    /^\/auth\/me\/(preferences|notifications)$/, /^\/settings$/,
    /^\/(departments|locations|employees|rewards|goals)\/\d+$/,
    /^\/employees\/\d+\/deactivate$/,
    /^\/redemptions\/\d+\/(approve|reject|cancel|fulfill|payroll-approve|payroll-reject)$/,
  ],
  DELETE: [/^\/(departments|locations|rewards)\/\d+$/, /^\/stores\/access\/\d+\/\d+$/],
};

function safeDummyInput(value: unknown, key = ""): boolean {
  if (Array.isArray(value)) return value.every(item => safeDummyInput(item, key));
  if (value && typeof value === "object") return Object.entries(value).every(([k, v]) => safeDummyInput(v, k));
  if (typeof value !== "string") return true;
  if (/email$/i.test(key) && value && !/^[^@\s]+@example\.test$/i.test(value)) return false;
  if (/imageurl/i.test(key) && value) return false;
  // Do not accept real card credentials or authentication links anywhere.
  return !/LBGC-/i.test(value) && !/https?:\/\//i.test(value);
}

export function trainingBoundary(router: Router): RequestHandler {
  return async (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Legend-Bucks-Mode": "training" });
    if (process.env.TRAINING_MODE_ENABLED !== "true") {
      res.status(503).json({ error: "Training is disabled" }); return;
    }
    if (!allowed[req.method]?.some(pattern => pattern.test(req.path))) {
      res.status(403).json({ error: "This action is unavailable in training" }); return;
    }
    if (!req.headers.authorization?.startsWith("Bearer training_")) {
      res.status(401).json({ error: "A training session is required" }); return;
    }
    if (!safeDummyInput(req.body)) {
      res.status(400).json({ error: "Use dummy @example.test addresses and training references only; external URLs and uploads are blocked" }); return;
    }
    // Buffer completion until the transaction commits. This also keeps reset
    // from racing any reads/writes and prevents success before durable commit.
    const end = res.end;
    let responseArgs: Parameters<typeof res.end> | undefined;
    try {
      await withTrainingTransaction(async () => {
        await new Promise<void>((resolve, reject) => {
          res.end = ((...args: Parameters<typeof res.end>) => {
            responseArgs = args;
            resolve();
            return res;
          }) as typeof res.end;
          req.currentUser = undefined;
          router(req, res, error => {
            if (error) reject(new Error("Training request failed"));
            else res.status(404).json({ error: "Training route not found" });
          });
        });
      });
      res.end = end;
      const disposition = res.getHeader("Content-Disposition");
      if (typeof disposition === "string") res.setHeader("Content-Disposition", disposition.replace('filename="', 'filename="TRAINING-'));
      end.apply(res, responseArgs ?? []);
    } catch {
      res.end = end;
      res.removeHeader("Content-Length");
      res.removeHeader("ETag");
      res.removeHeader("Content-Disposition");
      res.status(503).json({ error: "Training unavailable. No live fallback was used." });
    }
  };
}
