import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import {
  SetHistoryPinBody,
  SetHistoryPinResponse,
  RemoveHistoryPinBody,
  UnlockHistoryBody,
  UnlockHistoryResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { getOrCreateProfile } from "../lib/getOrCreateProfile";
import {
  hashPin,
  verifyPin,
  createHistoryToken,
  isHistoryLockedOut,
  recordFailedHistoryAttempt,
  clearFailedHistoryAttempts,
} from "../lib/historyAccess";

const router: IRouter = Router();

router.post("/history/pin", requireAuth, async (req, res): Promise<void> => {
  const parsed = SetHistoryPinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;

  if (isHistoryLockedOut(userId)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }

  const profile = await getOrCreateProfile(userId);

  if (profile.historyPinHash) {
    if (!parsed.data.currentPin || !verifyPin(parsed.data.currentPin, profile.historyPinHash)) {
      recordFailedHistoryAttempt(userId);
      res.status(403).json({ error: "Current PIN is incorrect" });
      return;
    }
  }

  await db
    .update(profilesTable)
    .set({ historyPinHash: hashPin(parsed.data.pin) })
    .where(eq(profilesTable.userId, userId));

  clearFailedHistoryAttempts(userId);
  res.json(SetHistoryPinResponse.parse(createHistoryToken(userId)));
});

router.delete("/history/pin", requireAuth, async (req, res): Promise<void> => {
  const parsed = RemoveHistoryPinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;

  if (isHistoryLockedOut(userId)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }

  const profile = await getOrCreateProfile(userId);

  if (!profile.historyPinHash) {
    res.sendStatus(204);
    return;
  }

  if (!verifyPin(parsed.data.currentPin, profile.historyPinHash)) {
    recordFailedHistoryAttempt(userId);
    res.status(403).json({ error: "Current PIN is incorrect" });
    return;
  }

  await db.update(profilesTable).set({ historyPinHash: null }).where(eq(profilesTable.userId, userId));
  clearFailedHistoryAttempts(userId);
  res.sendStatus(204);
});

router.post("/history/unlock", requireAuth, async (req, res): Promise<void> => {
  const parsed = UnlockHistoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;

  if (isHistoryLockedOut(userId)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }

  const profile = await getOrCreateProfile(userId);
  if (!profile.historyPinHash) {
    res.status(400).json({ error: "No History PIN is configured" });
    return;
  }

  if (!verifyPin(parsed.data.pin, profile.historyPinHash)) {
    recordFailedHistoryAttempt(userId);
    res.status(401).json({ error: "Incorrect PIN" });
    return;
  }

  clearFailedHistoryAttempts(userId);
  res.json(UnlockHistoryResponse.parse(createHistoryToken(userId)));
});

export default router;
