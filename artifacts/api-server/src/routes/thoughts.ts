import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, thoughtsTable } from "@workspace/db";
import { CreateThoughtBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/thoughts", async (req, res): Promise<void> => {
  const thoughts = await db
    .select()
    .from(thoughtsTable)
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
  const [thought] = await db.insert(thoughtsTable).values({ content: parsed.data.content }).returning();
  res.status(201).json({ ...thought, createdAt: thought.createdAt.toISOString() });
});

router.delete("/thoughts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(thoughtsTable).where(eq(thoughtsTable.id, id));
  res.status(204).end();
});

export default router;
