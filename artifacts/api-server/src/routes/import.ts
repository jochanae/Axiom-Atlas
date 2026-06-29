import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq, and } from "drizzle-orm";
import { db, projectsTable, entriesTable } from "@workspace/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const router: IRouter = Router();

router.options("/import", (_req, res) => {
  res.set(CORS_HEADERS).sendStatus(200);
});

const ImportDecisionSchema = z.object({
  tier: z.number().int().min(1).max(3),
  text: z.string().min(1),
});

const ImportBodySchema = z.object({
  project_name: z.string().min(1),
  builder: z.string().optional(),
  nodes_resolved: z.array(z.string()).optional(),
  manifest: z.string().optional(),
  decisions: z.array(ImportDecisionSchema).optional(),
});

function tierToCategory(tier: number): string {
  if (tier === 1) return "STRUCTURE";
  if (tier === 2) return "LOGIC";
  return "GENERAL";
}

router.post("/import", async (req, res): Promise<void> => {
  const parsed = ImportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { project_name, builder, nodes_resolved, decisions } = parsed.data;

  const userId = (req as any).authUser.id as number;

  const existing = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.userId, userId), eq(projectsTable.name, project_name)))
    .limit(1);

  let projectId: number;
  let matched = false;

  if (existing.length > 0) {
    projectId = existing[0].id;
    matched = true;
  } else {
    const [project] = await db
      .insert(projectsTable)
      .values({
        name: project_name,
        description: [
          builder ? `Builder: ${builder}` : null,
          nodes_resolved?.length ? `Nodes: ${nodes_resolved.join(", ")}` : null,
        ].filter(Boolean).join(" | ") || null,
        userId,
      })
      .returning();
    projectId = project.id;
  }

  if (decisions?.length) {
    await db.insert(entriesTable).values(
      decisions.map((d) => ({
        projectId,
        title: d.text,
        status: "committed" as const,
        severity: "committed" as const,
        mode: tierToCategory(d.tier),
        verb: "axiom_import",
      }))
    );
  }

  res.set(CORS_HEADERS).status(matched ? 200 : 201).json({ projectId, matched });
});

export default router;
