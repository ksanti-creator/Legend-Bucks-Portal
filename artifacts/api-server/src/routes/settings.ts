import { Router } from "express";
import type { IRouter } from "express";
import { GetSettingsResponse, UpdateSettingsBody, UpdateSettingsResponse } from "@workspace/api-zod";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { getMaxSingleAward, setMaxSingleAward } from "../lib/settings";

const router: IRouter = Router();

// Any authenticated user may read the global settings — the single-award max is
// an org-wide policy the send-bucks form validates against, not sensitive data.
router.get("/settings", requireAuth, async (_req, res): Promise<void> => {
  const maxSingleAward = await getMaxSingleAward();
  res.json(GetSettingsResponse.parse({ maxSingleAward }));
});

// Only admins may change global settings.
router.patch("/settings", requireAuth, async (req, res): Promise<void> => {
  const user = getCurrentUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  await setMaxSingleAward(body.data.maxSingleAward ?? null);
  const maxSingleAward = await getMaxSingleAward();
  res.json(UpdateSettingsResponse.parse({ maxSingleAward }));
});

export default router;
