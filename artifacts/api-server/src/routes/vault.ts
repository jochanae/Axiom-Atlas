import { Router, type IRouter } from "express";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { db, vaultTable } from "@workspace/db";

const router: IRouter = Router();

const CreateVaultBody = z.object({
  projectId: z.number().int().positive().optional().nullable(),
  projectName: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  entryCount: z.number().int().min(0).default(0),
  tags: z.array(z.string()).optional().nullable(),
});

function serialize(v: typeof vaultTable.$inferSelect) {
  return {
    ...v,
    createdAt: v.createdAt.toISOString(),
  };
}

router.get("/vault", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const rows = await db
    .select()
    .from(vaultTable)
    .where(eq(vaultTable.userId, userId))
    .orderBy(desc(vaultTable.createdAt))
    .limit(200);
  res.json(rows.map(serialize));
});

router.post("/vault", async (req, res): Promise<void> => {
  const parsed = CreateVaultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = (req as any).authUser.id as number;
  const [row] = await db.insert(vaultTable).values({
    userId,
    projectId: parsed.data.projectId ?? null,
    projectName: parsed.data.projectName,
    title: parsed.data.title,
    content: parsed.data.content,
    entryCount: parsed.data.entryCount,
    tags: parsed.data.tags ?? null,
  }).returning();
  res.status(201).json(serialize(row));
});

router.delete("/vault/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = (req as any).authUser.id as number;
  // Only delete rows owned by the requesting user
  await db.delete(vaultTable).where(and(eq(vaultTable.id, id), eq(vaultTable.userId, userId)));
  res.status(204).end();
});

export default router;
