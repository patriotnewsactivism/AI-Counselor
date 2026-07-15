import { Router, type IRouter } from "express";
import { count, eq, inArray, max } from "drizzle-orm";
import { db, conversationsTable, messagesTable, memoriesTable } from "@workspace/db";
import { GetStatsResponse } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/stats", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;

  const conversations = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.userId, userId));
  const conversationIds = conversations.map((c) => c.id);

  const [{ value: memoryCount = 0 } = {}] = await db
    .select({ value: count() })
    .from(memoriesTable)
    .where(eq(memoriesTable.userId, userId));

  let messageCount = 0;
  let lastActiveAt: Date | null = null;

  if (conversationIds.length > 0) {
    const [row] = await db
      .select({ value: count(), lastAt: max(messagesTable.createdAt) })
      .from(messagesTable)
      .where(inArray(messagesTable.conversationId, conversationIds));
    messageCount = row?.value ?? 0;
    lastActiveAt = row?.lastAt ?? null;
  }

  res.json(
    GetStatsResponse.parse({
      conversationCount: conversationIds.length,
      messageCount,
      memoryCount,
      lastActiveAt,
    }),
  );
});

export default router;
