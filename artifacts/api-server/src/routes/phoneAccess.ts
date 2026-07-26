import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import {
  SetPhoneAccessCodeBody,
  SetPhoneAccessCodeResponse,
  RemovePhoneAccessCodeBody,
  RemovePhoneAccessCodeResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { getOrCreateProfile } from "../lib/getOrCreateProfile";
import { hashPin, verifyPin } from "../lib/historyAccess";
import { toProfileResponse } from "../lib/toProfileResponse";
import { isPhoneAccessLockedOut, recordFailedPhoneAccessAttempt, clearFailedPhoneAccessAttempts } from "../lib/phoneAccess";

const router: IRouter = Router();

router.post("/phone-access/code", requireAuth, async (req, res): Promise<void> => {
  const parsed = SetPhoneAccessCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;

  if (isPhoneAccessLockedOut(userId)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }

  const profile = await getOrCreateProfile(userId);

  if (profile.phoneAccessCodeHash) {
    if (!parsed.data.currentCode || !verifyPin(parsed.data.currentCode, profile.phoneAccessCodeHash)) {
      recordFailedPhoneAccessAttempt(userId);
      res.status(403).json({ error: "Current code is incorrect" });
      return;
    }
  }

  const [updated] = await db
    .update(profilesTable)
    .set({ phoneAccessCodeHash: hashPin(parsed.data.code) })
    .where(eq(profilesTable.userId, userId))
    .returning();

  clearFailedPhoneAccessAttempts(userId);
  res.json(SetPhoneAccessCodeResponse.parse(toProfileResponse(updated)));
});

router.delete("/phone-access/code", requireAuth, async (req, res): Promise<void> => {
  const parsed = RemovePhoneAccessCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;

  if (isPhoneAccessLockedOut(userId)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }

  const profile = await getOrCreateProfile(userId);

  if (!profile.phoneAccessCodeHash) {
    res.json(RemovePhoneAccessCodeResponse.parse(toProfileResponse(profile)));
    return;
  }

  if (!verifyPin(parsed.data.currentCode, profile.phoneAccessCodeHash)) {
    recordFailedPhoneAccessAttempt(userId);
    res.status(403).json({ error: "Current code is incorrect" });
    return;
  }

  const [updated] = await db
    .update(profilesTable)
    .set({ phoneAccessCodeHash: null })
    .where(eq(profilesTable.userId, userId))
    .returning();

  clearFailedPhoneAccessAttempts(userId);
  res.json(RemovePhoneAccessCodeResponse.parse(toProfileResponse(updated)));
});

export default router;
