import { Router } from "express";
import { db, applicationModelsTable, designPlansTable, projectsTable, projectDnaTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { logger } from "../lib/logger";
import Anthropic from "@anthropic-ai/sdk";
import { logProjectArtifact } from "../lib/artifactLog";
import { createCheckpoint } from "./checkpoints";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// PATCH-specific schema: all fields fully optional, no defaults injected.
// This ensures omitted fields are treated as "no change", not "set to default".
const PatchBodyFieldSchema = z.object({
  navigationPattern: z.string().optional(),
  responsiveIntent: z.object({
    mobile: z.string().optional(),
    tablet: z.string().optional(),
    desktop: z.string().optional(),
  }).optional(),
  informationHierarchy: z.array(z.string()).optional(),
  componentPatterns: z.string().optional(),
  motionPhilosophy: z.string().optional(),
  cardDensity: z.string().optional(),
  typographyScale: z.string().optional(),
  emptyStates: z.string().optional(),
  interactionPatterns: z.object({
    primaryAction: z.string().optional(),
    secondaryAction: z.string().optional(),
    editingStyle: z.string().optional(),
    confirmationBehavior: z.string().optional(),
    gestures: z.string().optional(),
    scrollingBehavior: z.string().optional(),
  }).optional(),
});

const PatchBodySchema = z.object({ body: PatchBodyFieldSchema });

type PatchBodyFields = z.infer<typeof PatchBodyFieldSchema>;

/** Deep merge for Design Plan body: shallow top-level, deep for nested objects. */
function mergePlanBody(
  existing: Record<string, unknown>,
  patch: PatchBodyFields,
): Record<string, unknown> {
  const result = { ...existing };

  // Scalar top-level fields: overwrite if provided
  for (const key of [
    "navigationPattern", "componentPatterns", "motionPhilosophy",
    "cardDensity", "typographyScale", "emptyStates",
  ] as const) {
    if (patch[key] !== undefined) result[key] = patch[key];
  }

  // informationHierarchy: overwrite only if explicitly provided
  if (patch.informationHierarchy !== undefined) {
    result.informationHierarchy = patch.informationHierarchy;
  }

  // responsiveIntent: deep merge — preserve sibling keys not in patch
  if (patch.responsiveIntent !== undefined) {
    const prev = (existing.responsiveIntent as Record<string, unknown>) ?? {};
    result.responsiveIntent = { ...prev, ...patch.responsiveIntent };
  }

  // interactionPatterns: deep merge — preserve sibling keys not in patch
  if (patch.interactionPatterns !== undefined) {
    const prev = (existing.interactionPatterns as Record<string, unknown>) ?? {};
    result.interactionPatterns = { ...prev, ...patch.interactionPatterns };
  }

  return result;
}

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

function serializePlan(row: typeof designPlansTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    status: row.status,
    body: row.body ?? {},
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt ? row.committedAt.toISOString() : null,
  };
}

async function getLatestPlan(projectId: number) {
  const rows = await db
    .select()
    .from(designPlansTable)
    .where(eq(designPlansTable.projectId, projectId))
    .orderBy(desc(designPlansTable.version))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

const DESIGN_PLAN_PROMPT = `You are generating a Design Plan for a software product. Read the Application Model below and produce a structured JSON design brief.

APPLICATION MODEL:
{APPLICATION_MODEL}

Generate a JSON object that defines HOW this product should be visually and interactively designed. Base everything on the project's identity, intent, experience intent, and creative principles.

Return ONLY this JSON structure, no explanation:

{
  "navigationPattern": "e.g. bottom-tab-bar | sidebar | top-nav | single-page-scroll | hamburger-menu",
  "responsiveIntent": {
    "mobile": "one specific sentence describing mobile layout approach",
    "tablet": "one specific sentence describing tablet layout approach",
    "desktop": "one specific sentence describing desktop layout approach"
  },
  "informationHierarchy": [
    "Most prominent information first",
    "Secondary information second",
    "etc."
  ],
  "componentPatterns": "e.g. card-grid | list-view | dashboard | feed | kanban | table",
  "motionPhilosophy": "e.g. minimal | purposeful | expressive | none",
  "cardDensity": "e.g. spacious | compact | dense",
  "typographyScale": "e.g. large | standard | compact",
  "emptyStates": "e.g. illustrated | instructional | minimal | none",
  "interactionPatterns": {
    "primaryAction": "name the main action a user takes",
    "secondaryAction": "name the secondary action",
    "editingStyle": "e.g. inline | modal | separate-page | sheet",
    "confirmationBehavior": "e.g. minimal | explicit | undo-based",
    "gestures": "e.g. swipe-to-delete | pull-to-refresh | none | swipe to complete",
    "scrollingBehavior": "e.g. paginated | infinite | fixed-viewport"
  }
}

Rules:
- All values must be specific to this product — no generic placeholders
- Derive from the experience intent (emotional register, visual language, interaction posture) when available
- If the model has insufficient information for a field, omit it
- informationHierarchy: 2-4 items maximum, each a specific statement about THIS product's content priority
- Respond with ONLY the JSON object`;

async function generateDesignPlanBody(projectId: number): Promise<Record<string, unknown>> {
  const [rows, dnaRows] = await Promise.all([
    db.select().from(applicationModelsTable).where(eq(applicationModelsTable.projectId, projectId)).limit(1),
    db.select().from(projectDnaTable).where(eq(projectDnaTable.projectId, projectId)).limit(1),
  ]);

  if (rows.length === 0) return {};
  const model = rows[0];
  const dna = dnaRows[0] ?? null;

  const modelSummary = {
    identity: model.identity ?? {},
    intent: model.intent ?? {},
    creativePrinciples: (dna?.creativePrinciples as string[]) ?? [],
    experienceIntent: (dna?.experienceIntent as Record<string, unknown>) ?? {},
    pages: (model.pages as Array<{ name: string; route?: string }> ?? []).slice(0, 10).map((p) => ({ name: p.name, route: p.route })),
  };

  const prompt = DESIGN_PLAN_PROMPT.replace("{APPLICATION_MODEL}", JSON.stringify(modelSummary, null, 2));

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  if (!raw) return {};

  const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    logger.warn({ raw, projectId }, "designPlan generate: JSON parse failed");
    return {};
  }
}

// GET /api/projects/:id/design-plan
// Returns the latest design plan for this project (any status), or null if none exists.
router.get("/projects/:id/design-plan", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const plan = await getLatestPlan(projectId);
    res.json(plan ? serializePlan(plan) : null);
  } catch (err) {
    req.log.error({ err }, "GET /projects/:id/design-plan failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/projects/:id/design-plan/generate
// Generates a new proposed Design Plan from the current Application Model via AI.
router.post("/projects/:id/design-plan/generate", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const existing = await getLatestPlan(projectId);
    const nextVersion = existing ? existing.version + 1 : 1;
    const body = await generateDesignPlanBody(projectId);

    const [plan] = await db
      .insert(designPlansTable)
      .values({ projectId, version: nextVersion, status: "proposed", body })
      .returning();

    req.log.info({ projectId, planId: plan.id, version: nextVersion }, "design plan generated");
    res.json(serializePlan(plan));
  } catch (err) {
    req.log.error({ err }, "POST /projects/:id/design-plan/generate failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/projects/:id/design-plan
// Updates the body of the latest Design Plan.
// If the latest plan is committed, this forks a new proposed version with the merged body.
router.patch("/projects/:id/design-plan", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const parsed = PatchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const latest = await getLatestPlan(projectId);
    if (!latest) {
      res.status(404).json({ error: "No design plan exists — generate one first" });
      return;
    }

    const merged = mergePlanBody(latest.body as Record<string, unknown>, parsed.data.body);

    if (latest.status === "committed") {
      // Fork: create a new proposed version so the committed version is preserved
      const [forked] = await db
        .insert(designPlansTable)
        .values({ projectId, version: latest.version + 1, status: "proposed", body: merged })
        .returning();
      req.log.info({ projectId, planId: forked.id, version: forked.version }, "design plan forked from committed");
      res.json(serializePlan(forked));
    } else {
      const [updated] = await db
        .update(designPlansTable)
        .set({ body: merged })
        .where(eq(designPlansTable.id, latest.id))
        .returning();
      res.json(serializePlan(updated));
    }
  } catch (err) {
    req.log.error({ err }, "PATCH /projects/:id/design-plan failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/projects/:id/design-plan/commit
// Commits the latest Design Plan — status → committed, committedAt set.
router.post("/projects/:id/design-plan/commit", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(403).json({ error: "Forbidden" }); return; }

    const latest = await getLatestPlan(projectId);
    if (!latest) {
      res.status(404).json({ error: "No design plan exists — generate one first" });
      return;
    }
    if (latest.status === "committed") {
      res.json(serializePlan(latest));
      return;
    }

    const [committed] = await db
      .update(designPlansTable)
      .set({ status: "committed", committedAt: new Date() })
      .where(eq(designPlansTable.id, latest.id))
      .returning();

    req.log.info({ projectId, planId: committed.id, version: committed.version }, "design plan committed");

    // Log to artifact gallery — fire and forget
    void logProjectArtifact({
      projectId,
      type: "design_plan",
      version: committed.version,
      title: `Design Plan v${committed.version}`,
      metadata: { planId: committed.id, committedAt: committed.committedAt?.toISOString() ?? null },
      payload: committed.body as Record<string, unknown>,
    });

    // Checkpoint: each committed design plan version is a distinct milestone
    void createCheckpoint({
      projectId,
      type: "design",
      label: `Design Plan v${committed.version} committed`,
      title: `Design Plan v${committed.version}`,
      notes: `Committed by user. Plan ID: ${committed.id}.`,
      createdBy: "system",
      metadata: { planId: committed.id, version: committed.version },
    });

    res.json(serializePlan(committed));
  } catch (err) {
    req.log.error({ err }, "POST /projects/:id/design-plan/commit failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
