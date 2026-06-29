import { Router } from "express";
import { db, applicationModelsTable, applicationModelHistoryTable, projectsTable, projectFlowCanvasTable, sessionsTable, chatMessagesTable } from "@workspace/db";
import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";
import { ApplicationModelPatchSchema, ApplicationModelSchema, ApplicationModelHistorySchema } from "@workspace/db";
import { logger } from "../lib/logger";
import { syncFlowCanvasFromModel } from "../lib/flowMapSync";
import { logProjectArtifact } from "../lib/artifactLog";
import { getOrCreateDna, serializeDna } from "./projectDna";

export { syncFlowCanvasFromModel };

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

function serializeModel(row: typeof applicationModelsTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    identity: row.identity ?? {},
    intent: row.intent ?? {},
    pages: row.pages ?? [],
    components: row.components ?? [],
    data: row.data ?? { entities: [], relationships: [] },
    logic: row.logic ?? [],
    buildState: row.buildState ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrCreateApplicationModel(projectId: number) {
  const existing = await db
    .select()
    .from(applicationModelsTable)
    .where(eq(applicationModelsTable.projectId, projectId))
    .limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db
    .insert(applicationModelsTable)
    .values({ projectId })
    .returning();
  return created;
}

export async function seedMissingApplicationModels() {
  const projects = await db.select({ id: projectsTable.id }).from(projectsTable);
  for (const project of projects) {
    const existing = await db
      .select({ id: applicationModelsTable.id })
      .from(applicationModelsTable)
      .where(eq(applicationModelsTable.projectId, project.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(applicationModelsTable).values({ projectId: project.id }).onConflictDoNothing();
    }
  }
}

// GET /api/projects/:id/model
router.get("/projects/:id/model", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }
    const model = await getOrCreateApplicationModel(projectId);
    res.json(serializeModel(model));
  } catch (err) {
    req.log.error({ err }, "GET /projects/:id/model failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/projects/:id/model
router.patch("/projects/:id/model", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const parsed = ApplicationModelPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const { reason, ...fields } = parsed.data;
    const patchableFields = Object.keys(fields) as Array<keyof typeof fields>;
    if (patchableFields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const current = await getOrCreateApplicationModel(projectId);
    const newVersion = current.version + 1;

    const update: Record<string, unknown> = { version: newVersion };
    for (const field of patchableFields) {
      update[field] = fields[field];
    }

    await db
      .update(applicationModelsTable)
      .set(update as any)
      .where(eq(applicationModelsTable.projectId, projectId));

    const historyRows = patchableFields.map((field) => ({
      projectId,
      modelVersion: newVersion,
      fieldChanged: field,
      previousValue: (current as any)[field] ?? null,
      newValue: (fields as any)[field],
      reason: reason ?? null,
    }));
    await db.insert(applicationModelHistoryTable).values(historyRows);

    const updated = await getOrCreateApplicationModel(projectId);
    res.json(serializeModel(updated));

    // Flow Map → model-synced: when pages or data change, merge-sync the canvas
    // non-blocking so the PATCH response is never delayed.
    const flowRelevantFields = new Set(["pages", "data"]);
    if (patchableFields.some((f) => flowRelevantFields.has(f))) {
      syncFlowCanvasFromModel(projectId).catch((err) =>
        logger.warn({ err, projectId }, "flow sync after model patch failed — non-fatal")
      );
    }
  } catch (err) {
    req.log.error({ err }, "PATCH /projects/:id/model failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/projects/:id/model/history
router.get("/projects/:id/model/history", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const history = await db
      .select()
      .from(applicationModelHistoryTable)
      .where(eq(applicationModelHistoryTable.projectId, projectId))
      .orderBy(desc(applicationModelHistoryTable.changedAt))
      .limit(200);

    res.json(history.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      modelVersion: row.modelVersion,
      fieldChanged: row.fieldChanged,
      previousValue: row.previousValue ?? null,
      newValue: row.newValue ?? null,
      reason: row.reason ?? null,
      changedAt: row.changedAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "GET /projects/:id/model/history failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/projects/:id/model/approve
// Sets intent.approvedAt = now, recording the user's explicit sign-off on this AM version.
router.post("/projects/:id/model/approve", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const current = await getOrCreateApplicationModel(projectId);
    const newVersion = current.version + 1;
    const prevIntent = (current.intent as Record<string, unknown>) ?? {};
    const newIntent = { ...prevIntent, approvedAt: new Date().toISOString() };

    await db.update(applicationModelsTable)
      .set({ version: newVersion, intent: newIntent })
      .where(eq(applicationModelsTable.projectId, projectId));

    await db.insert(applicationModelHistoryTable).values([{
      projectId,
      modelVersion: newVersion,
      fieldChanged: "intent",
      previousValue: prevIntent,
      newValue: newIntent,
      reason: "blueprint-approved",
    }]);

    const updated = await getOrCreateApplicationModel(projectId);

    // Log full AM snapshot (including DNA) to artifact gallery — fire and forget
    void (async () => {
      try {
        const dna = await getOrCreateDna(projectId);
        const dnaData = serializeDna(dna);
        await logProjectArtifact({
          projectId,
          type: "blueprint_snapshot",
          version: newVersion,
          title: `Blueprint v${newVersion}`,
          metadata: { approvedAt: newIntent.approvedAt as string },
          payload: {
            identity: updated.identity,
            intent: updated.intent,
            pages: updated.pages,
            components: updated.components,
            data: updated.data,
            logic: updated.logic,
            buildState: updated.buildState,
            creativePrinciples: dnaData.creativePrinciples,
            experienceIntent: dnaData.experienceIntent,
            snapshotVersion: newVersion,
            snapshotAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        logger.warn({ err, projectId }, "blueprint approve: artifact log failed — non-fatal");
      }
    })();

    res.json(serializeModel(updated));
  } catch (err) {
    req.log.error({ err }, "POST /projects/:id/model/approve failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/projects/:id/model/unapprove
// Clears intent.approvedAt so the blueprint can be revised before building.
router.post("/projects/:id/model/unapprove", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const current = await getOrCreateApplicationModel(projectId);
    const newVersion = current.version + 1;
    const prevIntent = (current.intent as Record<string, unknown>) ?? {};
    const { approvedAt: _removed, ...rest } = prevIntent;
    const newIntent = rest;

    await db.update(applicationModelsTable)
      .set({ version: newVersion, intent: newIntent })
      .where(eq(applicationModelsTable.projectId, projectId));

    await db.insert(applicationModelHistoryTable).values([{
      projectId,
      modelVersion: newVersion,
      fieldChanged: "intent",
      previousValue: prevIntent,
      newValue: newIntent,
      reason: "blueprint-unapproved",
    }]);

    const updated = await getOrCreateApplicationModel(projectId);
    res.json(serializeModel(updated));
  } catch (err) {
    req.log.error({ err }, "POST /projects/:id/model/unapprove failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/projects/:id/model/sync-flow
// Merge-syncs the Flow Map canvas from Application Model pages + data.entities.
// Safe to call repeatedly: AM-origin nodes are added/updated/removed to match the
// current model while user-created nodes and their positions are always preserved.
router.post("/projects/:id/model/sync-flow", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const result = await syncFlowCanvasFromModel(projectId);
    if (result.nodeCount === 0) {
      res.json({ synced: false, reason: "Application Model has no pages or entities yet", ...result });
      return;
    }
    res.json({ synced: true, ...result });
  } catch (err) {
    req.log.error({ err }, "POST /projects/:id/model/sync-flow failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Alignment helpers ────────────────────────────────────────────────────────

function toSlugs(name: string): string[] {
  const lower = name.toLowerCase().trim();
  const variants = [
    lower.replace(/\s+/g, ""),
    lower.replace(/\s+/g, "-"),
    lower.replace(/\s+/g, "_"),
    lower.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
  ];
  return [...new Set(variants)].filter((s) => s.length > 1);
}

function findInPaths(paths: string[], name: string, extra?: string): string | undefined {
  const slugs = toSlugs(name);
  if (extra) slugs.push(...toSlugs(extra.replace(/^\//, "")));
  return paths.find((fp) => slugs.some((v) => fp.includes(v)));
}

const SCHEMA_PATH_HINTS = ["schema", "model", "type", "entity", "db/", "database", "migration", "drizzle"];

function findEntityInPaths(paths: string[], name: string): string | undefined {
  const slugs = toSlugs(name);
  const schemaMatch = paths.find(
    (fp) => slugs.some((v) => fp.includes(v)) && SCHEMA_PATH_HINTS.some((h) => fp.includes(h))
  );
  return schemaMatch ?? paths.find((fp) => slugs.some((v) => fp.includes(v)));
}

// GET /api/projects/:id/model/alignment
// Compares the Application Model (pages/components/entities) against all file
// paths that Atlas has actually edited in this project's build sessions.
// Returns status: aligned | partial | drift | no-builds | empty
router.get("/projects/:id/model/alignment", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const model = await getOrCreateApplicationModel(projectId);

    type RawPage = { name: string; route?: string };
    type RawComp = { name: string };
    type RawEntity = { name: string };
    type RawArtifact = { type: string; label: string };

    const pages = (model.pages as RawPage[]) ?? [];
    const components = (model.components as RawComp[]) ?? [];
    const entities = ((model.data as any)?.entities as RawEntity[]) ?? [];

    if (pages.length === 0 && components.length === 0 && entities.length === 0) {
      res.json({ status: "empty", pages: [], components: [], entities: [], builtFileCount: 0, checkedAt: new Date().toISOString() });
      return;
    }

    // Gather all file paths edited across all sessions for this project
    const sessions = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.projectId, projectId));

    const sessionIds = sessions.map((s) => s.id);
    const rawPaths: string[] = [];

    if (sessionIds.length > 0) {
      const rows = await db
        .select({ runArtifacts: chatMessagesTable.runArtifacts })
        .from(chatMessagesTable)
        .where(and(inArray(chatMessagesTable.sessionId, sessionIds), isNotNull(chatMessagesTable.runArtifacts)));

      for (const row of rows) {
        const artifacts = row.runArtifacts as RawArtifact[] | null;
        if (!Array.isArray(artifacts)) continue;
        for (const a of artifacts) {
          if (a.type === "file" && a.label) rawPaths.push(a.label.toLowerCase());
        }
      }
    }

    const uniquePaths = [...new Set(rawPaths)];

    if (uniquePaths.length === 0) {
      res.json({
        status: "no-builds",
        pages: pages.map((p) => ({ name: p.name, found: false })),
        components: components.map((c) => ({ name: c.name, found: false })),
        entities: entities.map((e) => ({ name: e.name, found: false })),
        builtFileCount: 0,
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    const pageResults = pages.map((p) => {
      const match = findInPaths(uniquePaths, p.name, p.route);
      return { name: p.name, found: !!match, matchedFile: match };
    });
    const componentResults = components.map((c) => {
      const match = findInPaths(uniquePaths, c.name);
      return { name: c.name, found: !!match, matchedFile: match };
    });
    const entityResults = entities.map((e) => {
      const match = findEntityInPaths(uniquePaths, e.name);
      return { name: e.name, found: !!match, matchedFile: match };
    });

    const all = [...pageResults, ...componentResults, ...entityResults];
    const foundCount = all.filter((r) => r.found).length;
    const ratio = all.length > 0 ? foundCount / all.length : 0;
    const status = ratio >= 0.8 ? "aligned" : ratio >= 0.2 ? "partial" : "drift";

    logger.info({ projectId, status, foundCount, total: all.length, builtFileCount: uniquePaths.length }, "AM alignment checked");

    res.json({
      status,
      pages: pageResults,
      components: componentResults,
      entities: entityResults,
      builtFileCount: uniquePaths.length,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "GET /projects/:id/model/alignment failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
