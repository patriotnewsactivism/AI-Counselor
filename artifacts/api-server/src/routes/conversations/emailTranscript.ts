import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import { findOwnedConversation } from "./shared";
import { sendEmail } from "../../lib/resendEmail";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lets the user email themselves either the full transcript of a
 * conversation, or a single message (e.g. a link/resource the companion
 * shared) via messageId. No zod here, same reason as generate-image: this
 * package doesn't carry "zod/v4" as its own resolvable dependency, and
 * that broke a build once already today.
 */
router.post("/conversations/:id/email", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const toEmail = typeof req.body?.toEmail === "string" ? req.body.toEmail.trim() : "";
  const messageId = typeof req.body?.messageId === "number" ? req.body.messageId : undefined;

  if (!EMAIL_RE.test(toEmail)) {
    res.status(400).json({ error: "A valid toEmail is required" });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const conversation = await findOwnedConversation(id, userId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(asc(messagesTable.createdAt));

  let subject: string;
  let text: string;

  if (messageId != null) {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) {
      res.status(404).json({ error: "Message not found in this conversation" });
      return;
    }
    subject = "From your conversation";
    text = msg.content;
  } else {
    subject = conversation.title ? `Conversation transcript: ${conversation.title}` : "Conversation transcript";
    text = messages.map((m) => `${m.role === "user" ? "You" : "Companion"}: ${m.content}`).join("\n\n");
  }

  try {
    await sendEmail(toEmail, subject, text);
    res.status(200).json({ sent: true });
  } catch (err) {
    logger.error({ err }, "Email send failed");
    res.status(502).json({ error: "Failed to send email" });
  }
});

export default router;
