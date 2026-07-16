import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, voiceProfilesTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import {
  ListVoiceProfilesResponse,
  EnrollVoiceProfileBody,
  EnrollVoiceProfileResponse,
  UpdateVoiceProfileBody,
  UpdateVoiceProfileResponse,
  UpdateVoiceProfileParams,
  DeleteVoiceProfileParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /voice-profiles — list all enrolled voices for the account
router.get("/voice-profiles", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const profiles = await db
    .select({
      id: voiceProfilesTable.id,
      name: voiceProfilesTable.name,
      lastHeardAt: voiceProfilesTable.lastHeardAt,
      createdAt: voiceProfilesTable.createdAt,
    })
    .from(voiceProfilesTable)
    .where(eq(voiceProfilesTable.userId, userId))
    .orderBy(voiceProfilesTable.createdAt);

  res.json(ListVoiceProfilesResponse.parse(profiles));
});

// POST /voice-profiles — manually enrol a named voice
router.post("/voice-profiles", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const body = EnrollVoiceProfileBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [profile] = await db
    .insert(voiceProfilesTable)
    .values({
      userId,
      name: body.data.name,
      sampleAudio: body.data.audioBase64,
      sampleMimeType: body.data.mimeType,
    })
    .returning();

  res.status(201).json(EnrollVoiceProfileResponse.parse(profile));
});

// PATCH /voice-profiles/:id — rename
router.patch("/voice-profiles/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const params = UpdateVoiceProfileParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = UpdateVoiceProfileBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [updated] = await db
    .update(voiceProfilesTable)
    .set({ name: body.data.name })
    .where(and(eq(voiceProfilesTable.id, params.data.id), eq(voiceProfilesTable.userId, userId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Voice profile not found" }); return; }
  res.json(UpdateVoiceProfileResponse.parse(updated));
});

// DELETE /voice-profiles/:id
router.delete("/voice-profiles/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const params = DeleteVoiceProfileParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db
    .delete(voiceProfilesTable)
    .where(and(eq(voiceProfilesTable.id, params.data.id), eq(voiceProfilesTable.userId, userId)))
    .returning({ id: voiceProfilesTable.id });

  if (!deleted) { res.status(404).json({ error: "Voice profile not found" }); return; }
  res.status(204).send();
});

export default router;
