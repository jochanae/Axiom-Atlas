import { db, projectArtifactsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";

export const ARTIFACT_TYPES = [
  "design_plan",
  "blueprint_snapshot",
  "build_output",
  "visual_sketch",
  "landing_draft",
  "export_package",
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// Shared helper: log a generated artifact for a project.
// Version is assigned atomically via MAX(version)+1 inside a transaction
// to prevent duplicate version numbers under concurrent inserts.
export async function logProjectArtifact({
  projectId,
  type,
  version,
  title,
  metadata = {},
  payload = {},
}: {
  projectId: number;
  type: ArtifactType;
  version?: number;
  title: string;
  metadata?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (!(ARTIFACT_TYPES as readonly string[]).includes(type)) {
    logger.warn({ projectId, type }, "logProjectArtifact: unknown type — skipping");
    return;
  }
  // Retry up to 3 times on unique constraint violation (concurrent inserts racing on same version)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await db.transaction(async (tx) => {
        let resolvedVersion = version;
        if (resolvedVersion === undefined) {
          const [row] = await tx
            .select({ maxV: sql<number>`COALESCE(MAX(${projectArtifactsTable.version}), 0)` })
            .from(projectArtifactsTable)
            .where(
              and(
                eq(projectArtifactsTable.projectId, projectId),
                eq(projectArtifactsTable.type, type),
              ),
            );
          resolvedVersion = (Number(row?.maxV ?? 0)) + 1;
        }
        await tx.insert(projectArtifactsTable).values({
          projectId,
          type,
          version: resolvedVersion,
          title,
          metadata,
          payload,
        });
      });
      return; // success
    } catch (err: unknown) {
      const isUniqueViolation =
        err instanceof Error && err.message.includes("project_artifacts_version_uniq");
      if (isUniqueViolation && attempt < 3) {
        version = undefined; // recompute from MAX on next attempt
        logger.warn({ projectId, type, attempt }, "logProjectArtifact: version conflict — retrying");
        continue;
      }
      logger.warn({ err, projectId, type, attempt }, "logProjectArtifact: failed to insert — non-fatal");
      return;
    }
  }
}
