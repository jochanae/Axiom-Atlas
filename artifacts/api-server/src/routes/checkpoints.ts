/**
 * Project Checkpoints
 *
 * Checkpoints are verified restore points captured at meaningful project
 * milestones — richer than history snapshots, safer than just rolling back.
 *
 * Types:
 *   understanding — Project DNA confirmed (creative principles + experience intent)
 *   build         — First verified build (or significant build after major changes)
 *   design        — Design plan committed
 *   release       — Published / deployed
 *   manual        — User-triggered
 *
 * Auto-checkpoints are created exactly once per type (to avoid noise).
 * Manual checkpoints can be created any time.
 */
import { Router, type IRouter } from "express";
import { db, projectsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import crypto from "node:crypto";

const router: IRouter = Router();

export type CheckpointType = "understanding" | "build" | "design" | "release" | "manual";

const LABEL_MAP: Record<CheckpointType, string> = {
  understanding: "🧠 DNA Established",
  build: "🏗 First Verified Build",
  design: "🎨 Design Committed",
  release: "🚀 Published",
  manual: "⭐ Manual",
};

function makeId(): string {
  try {
    return `ckpt_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
  } catch {
    return `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

async function projectBelongsToUser(
  projectId: number,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export interface CreateCheckpointInput {
  projectId: number;
  type: CheckpointType;
  label?: string;
  title: string;
  notes?: string;
  createdBy?: string;
  dnaSnapshot?: Record<string, unknown>;
  amSnapshot?: Record<string, unknown>;
  buildRef?: string;
  messageRef?: number;
  /** Extra caller-supplied context — merged into am_snapshot under `_meta` key. */
  metadata?: Record<string, unknown>;
}

export async function createCheckpoint(
  input: CreateCheckpointInput,
): Promise<string> {
  const id = makeId();
  await db.execute(sql`
    INSERT INTO project_checkpoints (
      id, project_id, type, label, title, notes, created_by,
      dna_snapshot, am_snapshot, build_ref, message_ref, created_at
    ) VALUES (
      ${id},
      ${input.projectId},
      ${input.type},
      ${input.label ?? LABEL_MAP[input.type]},
      ${input.title},
      ${input.notes ?? null},
      ${input.createdBy ?? "system"},
      ${JSON.stringify(input.dnaSnapshot ?? {})}::jsonb,
      ${JSON.stringify({ ...(input.amSnapshot ?? {}), ...(input.metadata ? { _meta: input.metadata } : {}) })}::jsonb,
      ${input.buildRef ?? null},
      ${input.messageRef ?? null},
      now()
    )
  `);
  return id;
}

/**
 * Create an auto-checkpoint ONLY if none of the given type already exists for
 * this project. This prevents noise — each milestone is captured once.
 * Returns the new checkpoint ID, or null if skipped.
 */
export async function createAutoCheckpointOnce(
  input: CreateCheckpointInput,
): Promise<string | null> {
  try {
    const result = (await db.execute(sql`
      SELECT COUNT(*) AS count FROM project_checkpoints
      WHERE project_id = ${input.projectId} AND type = ${input.type}
    `)) as unknown as { rows: Array<{ count: string }> };
    const count = parseInt(result.rows[0]?.count ?? "0", 10);
    if (count > 0) return null;
    const id = await createCheckpoint({ ...input, createdBy: "system" });
    logger.info(
      { projectId: input.projectId, type: input.type, title: input.title },
      "Auto-checkpoint created",
    );
    return id;
  } catch (err) {
    logger.warn(
      { err, projectId: input.projectId },
      "Auto-checkpoint failed — non-fatal",
    );
    return null;
  }
}

/* ── Routes ─────────────────────────────────────────────────────────── */

// GET /api/projects/:id/checkpoints
router.get("/projects/:id/checkpoints", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const projectId = parseInt(req.params.id, 10);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  if (!(await projectBelongsToUser(projectId, userId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  try {
    const result = (await db.execute(sql`
      SELECT * FROM project_checkpoints
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 50
    `)) as unknown as { rows: Record<string, unknown>[] };
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "GET /projects/:id/checkpoints failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/projects/:id/checkpoints (manual creation)
router.post("/projects/:id/checkpoints", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const projectId = parseInt(req.params.id, 10);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  if (!(await projectBelongsToUser(projectId, userId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { type = "manual", title, notes, buildRef, messageRef } =
    req.body ?? {};
  if (!title || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    // Snapshot current DNA + AM state at the moment of this checkpoint
    const [dnaResult, amResult] = await Promise.allSettled([
      db.execute(sql`
        SELECT creative_principles, experience_intent, status
        FROM project_dna WHERE project_id = ${projectId}
      `),
      db.execute(sql`
        SELECT identity, intent, pages, build_state
        FROM application_models WHERE project_id = ${projectId}
      `),
    ]);

    const dnaRow =
      dnaResult.status === "fulfilled"
        ? (
            (dnaResult.value as unknown as {
              rows: Record<string, unknown>[];
            }).rows[0] ?? {}
          )
        : {};
    const amRow =
      amResult.status === "fulfilled"
        ? (
            (amResult.value as unknown as {
              rows: Record<string, unknown>[];
            }).rows[0] ?? {}
          )
        : {};

    const safeType: CheckpointType =
      (["understanding", "build", "design", "release", "manual"] as const).includes(
        type as CheckpointType,
      )
        ? (type as CheckpointType)
        : "manual";

    const id = await createCheckpoint({
      projectId,
      type: safeType,
      label: LABEL_MAP[safeType],
      title: title.trim(),
      notes:
        typeof notes === "string" ? notes.trim() || undefined : undefined,
      createdBy: "user",
      dnaSnapshot: dnaRow as Record<string, unknown>,
      amSnapshot: amRow as Record<string, unknown>,
      buildRef: typeof buildRef === "string" ? buildRef : undefined,
      messageRef: typeof messageRef === "number" ? messageRef : undefined,
    });

    const created = (await db.execute(sql`
      SELECT * FROM project_checkpoints WHERE id = ${id}
    `)) as unknown as { rows: Record<string, unknown>[] };

    logger.info(
      { projectId, checkpointId: id, type: safeType, title: title.trim() },
      "Manual checkpoint created",
    );
    res.status(201).json(created.rows[0] ?? { id });
  } catch (err) {
    req.log.error({ err }, "POST /projects/:id/checkpoints failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
