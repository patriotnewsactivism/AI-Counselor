import { desc, eq } from "drizzle-orm";
import {
  db,
  messagesTable,
  memoriesTable,
  type Message,
  type Profile,
} from "@workspace/db";
import { generateCompanionReply, generateCompanionReplyPipelined, extractMemories, type ChatTurn } from "@workspace/gemini";
import { logger } from "./logger";

const HISTORY_LIMIT = 20;

/**
 * Runs one full turn of the companion conversation: saves the user's
 * message, generates a reply grounded in profile + remembered facts +
 * recent history, saves the reply, then kicks off best-effort memory
 * extraction in the background (never blocks or fails the reply).
 */
export async function runCompanionExchange(params: {
  conversationId: number;
  profile: Profile;
  userContent: string;
  audioMimeType?: string;
  /** Voice-identified speaker name — null means account owner / unknown */
  speakerName?: string | null;
}): Promise<{ userMessage: Message; assistantMessage: Message }> {
  const { conversationId, profile, userContent } = params;

  const priorMessages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(HISTORY_LIMIT);

  const history: ChatTurn[] = priorMessages
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));

  const existingMemories = await db
    .select()
    .from(memoriesTable)
    .where(eq(memoriesTable.userId, profile.userId));

  const [userMessage] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      role: "user",
      content: userContent,
      audioMimeType: params.audioMimeType,
      speakerName: params.speakerName ?? null,
    })
    .returning();

  const replyText = await generateCompanionReply({
    companionName: profile.companionName,
    preferredName: profile.preferredName,
    memories: existingMemories.map((m) => m.content),
    history,
    userMessage: userContent,
    speakerName: params.speakerName ?? null,
  });

  const [assistantMessage] = await db
    .insert(messagesTable)
    .values({ conversationId, role: "assistant", content: replyText })
    .returning();

  extractMemories({
    userMessage: userContent,
    assistantReply: replyText,
    existingMemories: existingMemories.map((m) => m.content),
  })
    .then(async (facts) => {
      if (facts.length === 0) return;
      await db
        .insert(memoriesTable)
        .values(facts.map((content) => ({ userId: profile.userId, content })));
    })
    .catch((err) => {
      logger.warn({ err }, "Memory extraction failed, continuing without it");
    });

  return { userMessage, assistantMessage };
}

/**
 * Pipelined variant of runCompanionExchange: streams the LLM reply and
 * calls onSentence(text) as each sentence is generated, so the caller (the
 * voice-messages route) can kick off TTS synthesis on early sentences while
 * later ones are still generating — cutting total turn latency instead of
 * doing "generate full text, then synthesize full audio" strictly in series.
 */
export async function runCompanionExchangePipelined(
  params: {
    conversationId: number;
    profile: Profile;
    userContent: string;
    audioMimeType?: string;
    speakerName?: string | null;
  },
  onSentence: (sentence: string) => void,
): Promise<{ userMessage: Message; assistantMessage: Message }> {
  const { conversationId, profile, userContent } = params;

  const priorMessages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(HISTORY_LIMIT);

  const history: ChatTurn[] = priorMessages
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));

  const existingMemories = await db
    .select()
    .from(memoriesTable)
    .where(eq(memoriesTable.userId, profile.userId));

  const [userMessage] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      role: "user",
      content: userContent,
      audioMimeType: params.audioMimeType,
      speakerName: params.speakerName ?? null,
    })
    .returning();

  const replyText = await generateCompanionReplyPipelined(
    {
      companionName: profile.companionName,
      preferredName: profile.preferredName,
      memories: existingMemories.map((m) => m.content),
      history,
      userMessage: userContent,
      speakerName: params.speakerName ?? null,
    },
    onSentence,
  );

  const [assistantMessage] = await db
    .insert(messagesTable)
    .values({ conversationId, role: "assistant", content: replyText })
    .returning();

  extractMemories({
    userMessage: userContent,
    assistantReply: replyText,
    existingMemories: existingMemories.map((m) => m.content),
  })
    .then(async (facts) => {
      if (facts.length === 0) return;
      await db
        .insert(memoriesTable)
        .values(facts.map((content) => ({ userId: profile.userId, content })));
    })
    .catch((err) => {
      logger.warn({ err }, "Memory extraction failed, continuing without it");
    });

  return { userMessage, assistantMessage };
}
