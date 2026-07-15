import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import {
  ListMessagesParams,
  ListMessagesResponse,
  SendMessageParams,
  SendMessageBody,
  SendMessageResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import { getOrCreateProfile } from "../../lib/getOrCreateProfile";
import { runCompanionExchange } from "../../lib/companionExchange";
import { findOwnedConversation } from "./shared";

const router: IRouter = Router();

router.get("/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const conversation = await findOwnedConversation(params.data.id, userId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, params.data.id))
    .orderBy(asc(messagesTable.createdAt));

  res.json(ListMessagesResponse.parse(messages));
});

router.post("/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const params = SendMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SendMessageBody.safeParse(req.body);
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

  const { userMessage, assistantMessage } = await runCompanionExchange({
    conversationId: params.data.id,
    profile,
    userContent: body.data.content,
  });

  res.status(201).json(SendMessageResponse.parse({ userMessage, assistantMessage }));
});

export default router;
