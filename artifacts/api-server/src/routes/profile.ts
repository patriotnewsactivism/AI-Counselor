import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { GetProfileResponse, UpdateProfileBody, UpdateProfileResponse } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { getOrCreateProfile } from "../lib/getOrCreateProfile";

const router: IRouter = Router();

router.get("/profile", requireAuth, async (req, res): Promise<void> => {
  const profile = await getOrCreateProfile((req as AuthedRequest).userId);
  res.json(GetProfileResponse.parse(profile));
});

router.patch("/profile", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  await getOrCreateProfile(userId);

  const [updated] = await db
    .update(profilesTable)
    .set(parsed.data)
    .where(eq(profilesTable.userId, userId))
    .returning();

  res.json(UpdateProfileResponse.parse(updated));
});

export default router;
