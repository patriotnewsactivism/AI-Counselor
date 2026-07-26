import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { type AuthedRequest } from "./requireAuth";
import { verifyHistoryToken } from "../lib/historyAccess";

/**
 * Gates the conversation-browsing surface behind the History PIN (see
 * lib/historyAccess.ts). Users who haven't opted into a History PIN pass
 * through unchanged — this only restricts accounts that configured one.
 * Must run after requireAuth.
 */
export async function requireHistoryUnlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthedRequest).userId;

  const [profile] = await db
    .select({ historyPinHash: profilesTable.historyPinHash })
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile?.historyPinHash) {
    next();
    return;
  }

  const token = req.header("x-history-token");
  if (!verifyHistoryToken(token, userId)) {
    res.status(401).json({ error: "history_locked" });
    return;
  }

  next();
}
