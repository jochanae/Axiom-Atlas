import { Router } from "express";
import { db, projectDnaTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ProjectDnaPatchSchema } from "@workspace/db";
import { logger } from "../lib/logger";
import { createAutoCheckpointOnce } from "./checkpoints";

const router = Router();

function parseProjectId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

async function assertProjectOwner(projectId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function getOrCreateDna(projectId: number) {
  const existing = await db
    .select()
    .from(projectDnaTable)
    .where(eq(projectDnaTable.projectId, projectId))
    .limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db
    .insert(projectDnaTable)
    .values({ projectId })
    .returning();
  return created;
}

export function serializeDna(row: typeof projectDnaTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    creativePrinciples: (row.creativePrinciples as string[]) ?? [],
    experienceIntent: (row.experienceIntent as Record<string, unknown>) ?? {},
    visualSketches: (row.visualSketches as unknown[]) ?? [],
    confidence: (row.confidence as Record<string, number>) ?? {},
    status: (row.status as Record<string, string>) ?? {},
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /api/projects/:id/dna
router.get("/projects/:id/dna", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }
    const dna = await getOrCreateDna(projectId);
    res.json(serializeDna(dna));
  } catch (err) {
    req.log.error({ err }, "GET /projects/:id/dna failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/projects/:id/dna
router.patch("/projects/:id/dna", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const parsed = ProjectDnaPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const current = await getOrCreateDna(projectId);
    const patch = parsed.data;
    const updates: Record<string, unknown> = {};

    if (patch.creativePrinciples !== undefined) {
      updates.creativePrinciples = patch.creativePrinciples;
    }
    if (patch.experienceIntent !== undefined) {
      const prev = (current.experienceIntent as Record<string, unknown>) ?? {};
      updates.experienceIntent = { ...prev, ...(patch.experienceIntent as Record<string, unknown>) };
    }
    if (patch.visualSketches !== undefined) {
      updates.visualSketches = patch.visualSketches;
    }
    if (patch.confidence !== undefined) {
      const prev = (current.confidence as Record<string, unknown>) ?? {};
      updates.confidence = { ...prev, ...(patch.confidence as Record<string, unknown>) };
    }
    if (patch.status !== undefined) {
      const prev = (current.status as Record<string, unknown>) ?? {};
      updates.status = { ...prev, ...(patch.status as Record<string, unknown>) };
    }

    if (Object.keys(updates).length === 0) {
      res.json(serializeDna(current));
      return;
    }

    await db
      .update(projectDnaTable)
      .set(updates as any)
      .where(eq(projectDnaTable.projectId, projectId));

    const updated = await getOrCreateDna(projectId);
    logger.info({ projectId, fields: Object.keys(updates) }, "DNA patched");
    res.json(serializeDna(updated));

    // Auto-checkpoint: DNA Established — fire-and-forget, non-blocking.
    // Trigger when creative_principles becomes non-empty for the first time.
    const principles = (updated.creativePrinciples as unknown[]) ?? [];
    if (principles.length > 0) {
      createAutoCheckpointOnce({
        projectId,
        type: "understanding",
        title: "Project DNA Established",
        dnaSnapshot: {
          creativePrinciples: updated.creativePrinciples,
          experienceIntent: updated.experienceIntent,
          status: updated.status,
        },
      }).catch(() => {});
    }
  } catch (err) {
    req.log.error({ err }, "PATCH /projects/:id/dna failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
