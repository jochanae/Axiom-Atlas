/**
 * ProjectDNA — the canonical interface for reading and writing genome-class data.
 *
 * Application Model is the source of truth. This module provides:
 *  - `getProjectDNA(id)`          — read DNA for one project
 *  - `getOrCreateProjectDNA(id)`  — read or seed if missing
 *  - `getMultipleProjectDNA(ids)` — batch read, returns Map<id, ProjectDNA>
 *  - `updateProjectDNA(id, patch)` — write genome fields to AM
 *
 * `project_genome` table is kept as a read-only archive; nothing writes to it anymore.
 *
 * Genome-field → AM location mapping:
 *   purpose          → identity.purpose
 *   coreEmotion      → identity.coreEmotion
 *   audience         → identity.audience
 *   identity (text)  → identity.positioning   ← name clash resolved
 *   format           → identity.format
 *   surfaceStrategy  → identity.surfaceStrategy
 *   wedge            → identity.wedge
 *   differentiator   → identity.differentiator
 *   constraints      → intent.constraints
 *   openQuestions    → intent.openQuestions
 *   confidenceScore  → intent.confidenceScore
 *   stack            → intent.stack
 *   protectedAreas   → intent.protectedAreas
 *   stage            → buildState.stage
 *   lastEvolvedAt    → buildState.lastEvolvedAt (ISO string)
 *   lastExtractedAt  → buildState.lastExtractedAt (ISO string)
 */

import { db, applicationModelsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface ProjectDNA {
  purpose: string | null;
  coreEmotion: string | null;
  audience: string | null;
  identity: string | null;       // the positioning phrase (was genome.identity text)
  format: string | null;
  surfaceStrategy: string | null;
  wedge: string | null;
  differentiator: string | null;
  stack: string[];
  protectedAreas: string[];
  constraints: string[];
  openQuestions: string[];
  stage: string;
  confidenceScore: number;
  lastEvolvedAt: Date | null;
  lastExtractedAt: Date | null;
}

export interface ProjectDNAUpdate {
  purpose?: string | null;
  coreEmotion?: string | null;
  audience?: string | null;
  identity?: string | null;
  format?: string | null;
  surfaceStrategy?: string | null;
  wedge?: string | null;
  differentiator?: string | null;
  stack?: string[];
  protectedAreas?: string[];
  constraints?: string[];
  openQuestions?: string[];
  stage?: string;
  confidenceScore?: number;
  lastEvolvedAt?: Date | null;
  lastExtractedAt?: Date | null;
}

function rowToDNA(model: typeof applicationModelsTable.$inferSelect): ProjectDNA {
  const id = (model.identity as Record<string, unknown>) ?? {};
  const it = (model.intent as Record<string, unknown>) ?? {};
  const bs = (model.buildState as Record<string, unknown>) ?? {};
  return {
    purpose: (id.purpose as string) ?? null,
    coreEmotion: (id.coreEmotion as string) ?? null,
    audience: (id.audience as string) ?? null,
    identity: (id.positioning as string) ?? null,
    format: (id.format as string) ?? null,
    surfaceStrategy: (id.surfaceStrategy as string) ?? null,
    wedge: (id.wedge as string) ?? null,
    differentiator: (id.differentiator as string) ?? null,
    stack: (it.stack as string[]) ?? [],
    protectedAreas: (it.protectedAreas as string[]) ?? [],
    constraints: (it.constraints as string[]) ?? [],
    openQuestions: (it.openQuestions as string[]) ?? [],
    stage: (bs.stage as string) ?? "Think",
    confidenceScore: (it.confidenceScore as number) ?? 0,
    lastEvolvedAt: bs.lastEvolvedAt ? new Date(bs.lastEvolvedAt as string) : null,
    lastExtractedAt: bs.lastExtractedAt ? new Date(bs.lastExtractedAt as string) : null,
  };
}

export async function getProjectDNA(projectId: number): Promise<ProjectDNA | null> {
  const [row] = await db
    .select()
    .from(applicationModelsTable)
    .where(eq(applicationModelsTable.projectId, projectId))
    .limit(1);
  return row ? rowToDNA(row) : null;
}

export async function getOrCreateProjectDNA(projectId: number): Promise<ProjectDNA> {
  const [existing] = await db
    .select()
    .from(applicationModelsTable)
    .where(eq(applicationModelsTable.projectId, projectId))
    .limit(1);
  if (existing) return rowToDNA(existing);
  const [created] = await db
    .insert(applicationModelsTable)
    .values({ projectId })
    .returning();
  return rowToDNA(created);
}

export async function getMultipleProjectDNA(projectIds: number[]): Promise<Map<number, ProjectDNA>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(applicationModelsTable)
    .where(inArray(applicationModelsTable.projectId, projectIds));
  return new Map(rows.map((r) => [r.projectId, rowToDNA(r)]));
}

export async function updateProjectDNA(projectId: number, update: ProjectDNAUpdate): Promise<void> {
  const [current] = await db
    .select()
    .from(applicationModelsTable)
    .where(eq(applicationModelsTable.projectId, projectId))
    .limit(1);
  if (!current) return;

  const prevId = (current.identity as Record<string, unknown>) ?? {};
  const prevIt = (current.intent as Record<string, unknown>) ?? {};
  const prevBs = (current.buildState as Record<string, unknown>) ?? {};

  const newId: Record<string, unknown> = { ...prevId };
  if ("purpose" in update)        newId.purpose = update.purpose;
  if ("coreEmotion" in update)    newId.coreEmotion = update.coreEmotion;
  if ("audience" in update)       newId.audience = update.audience;
  if ("identity" in update)       newId.positioning = update.identity;  // name remap
  if ("format" in update)         newId.format = update.format;
  if ("surfaceStrategy" in update) newId.surfaceStrategy = update.surfaceStrategy;
  if ("wedge" in update)          newId.wedge = update.wedge;
  if ("differentiator" in update) newId.differentiator = update.differentiator;

  const newIt: Record<string, unknown> = { ...prevIt };
  if (update.constraints !== undefined)    newIt.constraints = update.constraints;
  if (update.openQuestions !== undefined)  newIt.openQuestions = update.openQuestions;
  if (update.confidenceScore !== undefined) newIt.confidenceScore = update.confidenceScore;
  if (update.stack !== undefined)          newIt.stack = update.stack;
  if (update.protectedAreas !== undefined) newIt.protectedAreas = update.protectedAreas;

  const newBs: Record<string, unknown> = { ...prevBs };
  if (update.stage !== undefined)          newBs.stage = update.stage;
  if ("lastEvolvedAt" in update)           newBs.lastEvolvedAt = update.lastEvolvedAt?.toISOString() ?? null;
  if ("lastExtractedAt" in update)         newBs.lastExtractedAt = update.lastExtractedAt?.toISOString() ?? null;

  await db
    .update(applicationModelsTable)
    .set({ version: current.version + 1, identity: newId, intent: newIt, buildState: newBs })
    .where(eq(applicationModelsTable.projectId, projectId));
}

/**
 * One-time boot migration: copy data from project_genome → application_models.
 * Idempotent — safe to run on every boot. Projects whose AM already has a
 * confidenceScore > 0 are skipped (already migrated or populated by extraction).
 */
export async function migrateGenomeToApplicationModel(): Promise<void> {
  const { pool } = await import("@workspace/db");
  try {
    const result = await pool.query<{
      project_id: number;
      purpose: string | null;
      core_emotion: string | null;
      audience: string | null;
      identity: string | null;
      format: string | null;
      surface_strategy: string | null;
      wedge: string | null;
      differentiator: string | null;
      stack: string[];
      protected_areas: string[];
      constraints: string[];
      open_questions: string[];
      stage: string;
      confidence_score: number;
      last_evolved_at: string | null;
      last_extracted_at: string | null;
    }>(`
      SELECT
        g.project_id,
        g.purpose,
        g.core_emotion,
        g.audience,
        g.identity,
        g.format,
        g.surface_strategy,
        g.wedge,
        g.differentiator,
        g.stack,
        g.protected_areas,
        g.constraints,
        g.open_questions,
        g.stage,
        g.confidence_score,
        g.last_evolved_at,
        g.last_extracted_at
      FROM project_genome g
      JOIN application_models am ON am.project_id = g.project_id
      WHERE
        g.confidence_score > 0
        OR g.purpose IS NOT NULL
        OR g.wedge IS NOT NULL
        OR g.audience IS NOT NULL
    `);

    if (result.rows.length === 0) {
      return;
    }

    let migrated = 0;
    for (const row of result.rows) {
      try {
        const [current] = await db
          .select({ id: applicationModelsTable.id, identity: applicationModelsTable.identity, intent: applicationModelsTable.intent, buildState: applicationModelsTable.buildState, version: applicationModelsTable.version })
          .from(applicationModelsTable)
          .where(eq(applicationModelsTable.projectId, row.project_id))
          .limit(1);

        if (!current) continue;

        const prevId = (current.identity as Record<string, unknown>) ?? {};
        const prevIt = (current.intent as Record<string, unknown>) ?? {};
        const prevBs = (current.buildState as Record<string, unknown>) ?? {};

        // Merge: genome fields fill gaps; don't overwrite AM fields that already exist
        // (conversation extraction may have already populated them with fresher data)
        const newId: Record<string, unknown> = {
          ...prevId,
          ...(row.purpose && !prevId.purpose ? { purpose: row.purpose } : {}),
          ...(row.core_emotion && !prevId.coreEmotion ? { coreEmotion: row.core_emotion } : {}),
          ...(row.audience && !prevId.audience ? { audience: row.audience } : {}),
          ...(row.identity && !prevId.positioning ? { positioning: row.identity } : {}),
          ...(row.format && !prevId.format ? { format: row.format } : {}),
          ...(row.surface_strategy && !prevId.surfaceStrategy ? { surfaceStrategy: row.surface_strategy } : {}),
          ...(row.wedge && !prevId.wedge ? { wedge: row.wedge } : {}),
          ...(row.differentiator && !prevId.differentiator ? { differentiator: row.differentiator } : {}),
        };

        const newIt: Record<string, unknown> = {
          ...prevIt,
          ...(row.constraints?.length && !(prevIt.constraints as unknown[])?.length ? { constraints: row.constraints } : {}),
          ...(row.open_questions?.length && !(prevIt.openQuestions as unknown[])?.length ? { openQuestions: row.open_questions } : {}),
          ...(row.confidence_score > 0 && !(prevIt.confidenceScore as number) ? { confidenceScore: row.confidence_score } : {}),
          ...(row.stack?.length && !(prevIt.stack as unknown[])?.length ? { stack: row.stack } : {}),
          ...(row.protected_areas?.length && !(prevIt.protectedAreas as unknown[])?.length ? { protectedAreas: row.protected_areas } : {}),
        };

        const newBs: Record<string, unknown> = {
          ...prevBs,
          ...((prevBs.stage === "Think" || !prevBs.stage) && row.stage !== "Think" ? { stage: row.stage } : {}),
          ...(row.last_evolved_at && !prevBs.lastEvolvedAt ? { lastEvolvedAt: row.last_evolved_at } : {}),
          ...(row.last_extracted_at && !prevBs.lastExtractedAt ? { lastExtractedAt: row.last_extracted_at } : {}),
        };

        await db
          .update(applicationModelsTable)
          .set({ version: current.version + 1, identity: newId, intent: newIt, buildState: newBs })
          .where(eq(applicationModelsTable.projectId, row.project_id));

        migrated++;
      } catch (err) {
        // Non-fatal per project — log and continue
        console.error(`genome→AM migration failed for project ${row.project_id}:`, err);
      }
    }

    if (migrated > 0) {
      console.log(`genome→AM migration: migrated ${migrated}/${result.rows.length} projects`);
    }
  } catch (err) {
    // Non-fatal — server continues if genome table doesn't exist or query fails
    console.error("genome→AM migration: failed —", err instanceof Error ? err.message : err);
  }
}
