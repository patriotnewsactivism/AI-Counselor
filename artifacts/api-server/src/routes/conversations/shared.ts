import { and, eq } from "drizzle-orm";
import { db, conversationsTable, type Conversation } from "@workspace/db";

/**
 * Loads a conversation scoped to its owner, so message/voice-message
 * routes can never read or write into someone else's conversation.
 */
export async function findOwnedConversation(
  conversationId: number,
  userId: string,
): Promise<Conversation | undefined> {
  const [conversation] = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.userId, userId)));
  return conversation;
}
