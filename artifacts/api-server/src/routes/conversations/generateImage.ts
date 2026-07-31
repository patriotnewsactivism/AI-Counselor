import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, messagesTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import { findOwnedConversation } from "./shared";
import { generateImage } from "../../lib/xaiImage";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const GenerateImageBody = z.object({ prompt: z.string().min(1).max(2000) });

/**
 * Image generation is its own endpoint rather than folded into the regular
 * /messages send flow: it skips the companion LLM reply pipeline entirely
 * (no history/memory grounding needed for "draw me a...") and calls xAI's
 * image model directly, storing the result as an assistant message with
 * imageUrl set so the normal message list can render it inline.
 */
router.post("/conversations/:id/generate-image", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const body = GenerateImageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const conversation = await findOwnedConversation(id, userId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const { prompt } = body.data;

  const [userMessage] = await db
    .insert(messagesTable)
    .values({ conversationId: id, role: "user", content: `\uD83C\uDFA8 ${prompt}` })
    .returning();

  try {
    const imageUrl = await generateImage(prompt);
    const [assistantMessage] = await db
      .insert(messagesTable)
      .values({
        conversationId: id,
        role: "assistant",
        content: `Here's what I imagined for "${prompt}":`,
        imageUrl,
      })
      .returning();
    res.status(201).json({ userMessage, assistantMessage });
  } catch (err) {
    logger.error({ err }, "Image generation failed");
    const [assistantMessage] = await db
      .insert(messagesTable)
      .values({
        conversationId: id,
        role: "assistant",
        content: "I couldn't generate that image just now \u2014 mind trying again in a moment?",
      })
      .returning();
    res.status(201).json({ userMessage, assistantMessage });
  }
});

export default router;
