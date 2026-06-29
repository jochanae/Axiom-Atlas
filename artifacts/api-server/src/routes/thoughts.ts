import { Router, type IRouter } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, thoughtsTable } from "@workspace/db";
import { CreateThoughtBody } from "@workspace/api-zod";
import { upsertEmbedding } from "../lib/embeddings";

const router: IRouter = Router();

router.get("/thoughts", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const thoughts = await db
    .select()
    .from(thoughtsTable)
    .where(eq(thoughtsTable.userId, userId))
    .orderBy(desc(thoughtsTable.createdAt))
    .limit(200);
  res.json(thoughts.map(t => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
  })));
});

router.post("/thoughts", async (req, res): Promise<void> => {
  const parsed = CreateThoughtBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = (req as any).authUser.id as number;
  const [thought] = await db
    .insert(thoughtsTable)
    .values({ content: parsed.data.content, userId })
    .returning();
  res.status(201).json({ ...thought, createdAt: thought.createdAt.toISOString() });

  // Fire-and-forget: index embedding for semantic search (V4)
  void upsertEmbedding({
    entityType: "thought",
    entityId: thought.id,
    userId,
    projectId: null,
    content: thought.content,
  }).catch(() => { /* silent */ });
});

router.delete("/thoughts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = (req as any).authUser.id as number;
  await db.delete(thoughtsTable).where(and(eq(thoughtsTable.id, id), eq(thoughtsTable.userId, userId)));
  res.status(204).end();
});

export default router;
