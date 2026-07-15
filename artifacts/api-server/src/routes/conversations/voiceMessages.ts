import { Router, type IRouter } from "express";
import { SendVoiceMessageParams, SendVoiceMessageBody, SendVoiceMessageResponse } from "@workspace/api-zod";
import { transcribeAudio, synthesizeSpeech } from "@workspace/deepgram";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import { getOrCreateProfile } from "../../lib/getOrCreateProfile";
import { runCompanionExchange } from "../../lib/companionExchange";
import { findOwnedConversation } from "./shared";

const router: IRouter = Router();

router.post("/conversations/:id/voice-messages", requireAuth, async (req, res): Promise<void> => {
  const params = SendVoiceMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SendVoiceMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const conversation = await findOwnedConversation(params.data.id, userId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const profile = await getOrCreateProfile(userId);

  let transcript: string;
  try {
    const audioBuffer = Buffer.from(body.data.audioBase64, "base64");
    transcript = await transcribeAudio(audioBuffer, body.data.mimeType);
  } catch (err) {
    req.log.warn({ err }, "Voice transcription failed");
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not transcribe audio",
    });
    return;
  }

  const { userMessage, assistantMessage } = await runCompanionExchange({
    conversationId: params.data.id,
    profile,
    userContent: transcript,
    audioMimeType: body.data.mimeType,
  });

  const { audio, mimeType } = await synthesizeSpeech(assistantMessage.content);

  res.status(201).json(
    SendVoiceMessageResponse.parse({
      userMessage,
      assistantMessage,
      audioBase64: audio.toString("base64"),
      audioMimeType: mimeType,
    }),
  );
});

export default router;
