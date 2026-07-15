import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, conversationsTable } from "@workspace/db";
import {
  ListConversationsResponse,
  CreateConversationBody,
  CreateConversationResponse,
  GetConversationParams,
  GetConversationResponse,
  DeleteConversationParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import messagesRouter from "./messages";
import voiceMessagesRouter from "./voiceMessages";

const router: IRouter = Router();

router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.userId, userId))
    .orderBy(desc(conversationsTable.updatedAt));
  res.json(ListConversationsResponse.parse(conversations));
});

router.post("/conversations", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const [conversation] = await db
    .insert(conversationsTable)
    .values({ ...parsed.data, userId })
    .returning();

  res.status(201).json(CreateConversationResponse.parse(conversation));
});

router.get("/conversations/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const [conversation] = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, params.data.id), eq(conversationsTable.userId, userId)));

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json(GetConversationResponse.parse(conversation));
});

router.delete("/conversations/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const [deleted] = await db
    .delete(conversationsTable)
    .where(and(eq(conversationsTable.id, params.data.id), eq(conversationsTable.userId, userId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.sendStatus(204);
});

router.use(messagesRouter);
router.use(voiceMessagesRouter);

export default router;
