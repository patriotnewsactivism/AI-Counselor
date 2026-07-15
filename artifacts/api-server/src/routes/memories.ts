import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, memoriesTable } from "@workspace/db";
import { ListMemoriesResponse, DeleteMemoryParams } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/memories", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const memories = await db
    .select()
    .from(memoriesTable)
    .where(eq(memoriesTable.userId, userId))
    .orderBy(desc(memoriesTable.createdAt));
  res.json(ListMemoriesResponse.parse(memories));
});

router.delete("/memories/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteMemoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const [deleted] = await db
    .delete(memoriesTable)
    .where(and(eq(memoriesTable.id, params.data.id), eq(memoriesTable.userId, userId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
