import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { connectionsTable, db, projectsTable, scheduledChecksTable } from "@workspace/db";
import { decryptToken } from "../lib/tokenCrypto";
import { logger } from "../lib/logger";
import { assertSafeUrl } from "../lib/ssrf";
import { createAutoCheckpointOnce } from "./checkpoints";

const router: IRouter = Router();

interface VercelDeployResponse {
  id?: string;
  url?: string;
  state?: string;
  alias?: string[];
  error?: { message?: string };
}

/**
 * POST /api/deploy
 * Trigger a Vercel deployment using the stored Vercel token.
 * Requires a Vercel connection to be saved first (POST /api/connections).
 * Body: { projectId?: string, teamId?: string }
 */
router.post("/deploy", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const body = req.body as { projectId?: string; teamId?: string };

  // Find the user's Vercel connection
  const [connection] = await db
    .select()
    .from(connectionsTable)
    .where(and(eq(connectionsTable.userId, userId), eq(connectionsTable.type, "vercel")))
    .orderBy(desc(connectionsTable.createdAt))
    .limit(1);

  if (!connection || !connection.token) {
    res.status(400).json({ error: "No Vercel connection found. Add one via Settings first." });
    return;
  }

  const token = decryptToken(connection.token);
  const projectId = body.projectId ?? (connection.metadata as Record<string, unknown>)?.projectId ?? null;
  const teamId = body.teamId ?? (connection.metadata as Record<string, unknown>)?.teamId ?? null;

  if (!projectId) {
    res.status(400).json({ error: "Vercel projectId required. Save it in connection metadata or pass it in body." });
    return;
  }

  try {
    const deployUrl = teamId
      ? `https://api.vercel.com/v6/deployments?teamId=${teamId}`
      : "https://api.vercel.com/v6/deployments";

    const deployRes = await fetch(deployUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectId,
        project: projectId,
        target: "production",
        // Let Vercel auto-detect framework + build
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await deployRes.json() as VercelDeployResponse;

    if (!deployRes.ok) {
      res.status(502).json({
        error: data.error?.message ?? "Vercel deploy failed",
        vercelStatus: deployRes.status,
      });
      return;
    }

    res.json({
      success: true,
      deploymentId: data.id ?? null,
      url: data.url ?? null,
      state: data.state ?? null,
      alias: data.alias ?? [],
    });
  } catch (err) {
    logger.error({ err: String(err), userId, projectId }, "Deploy trigger failed");
    res.status(500).json({ error: "Deploy trigger failed" });
  }
});

/**
 * GET /api/deploy/status
 * Check the latest deployment status for a Vercel project.
 * Query: ?projectId=...&teamId=...
 */
router.get("/deploy/status", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = req.query.projectId as string | undefined;
  const teamId = req.query.teamId as string | undefined;

  const [connection] = await db
    .select()
    .from(connectionsTable)
    .where(and(eq(connectionsTable.userId, userId), eq(connectionsTable.type, "vercel")))
    .orderBy(desc(connectionsTable.createdAt))
    .limit(1);

  if (!connection || !connection.token) {
    res.status(400).json({ error: "No Vercel connection found." });
    return;
  }

  const token = decryptToken(connection.token);
  const resolvedProjectId = projectId ?? (connection.metadata as Record<string, unknown>)?.projectId ?? null;

  if (!resolvedProjectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }

  try {
    const statusUrl = teamId
      ? `https://api.vercel.com/v6/deployments?projectId=${resolvedProjectId}&teamId=${teamId}&limit=1`
      : `https://api.vercel.com/v6/deployments?projectId=${resolvedProjectId}&limit=1`;

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!statusRes.ok) {
      res.status(502).json({ error: "Failed to fetch deploy status" });
      return;
    }

    const data = await statusRes.json() as {
      deployments?: Array<{
        id?: string;
        url?: string;
        state?: string;
        created?: number;
        readyState?: string;
        alias?: string[];
      }>;
    };

    const deploy = data.deployments?.[0];
    if (!deploy) {
      res.json({ status: "none", message: "No deployments found" });
      return;
    }

    const state = deploy.state?.toLowerCase() ?? deploy.readyState?.toLowerCase() ?? "unknown";
    const status = state.includes("ready") || state.includes("completed")
      ? "ready"
      : state.includes("error") || state.includes("failed")
        ? "failed"
        : state.includes("build") || state.includes("queued") || state.includes("initializing")
          ? "building"
          : "pending";

    res.json({
      status,
      deploymentId: deploy.id ?? null,
      url: deploy.url ?? null,
      alias: deploy.alias ?? [],
      createdAt: deploy.created ? new Date(deploy.created).toISOString() : null,
    });
  } catch (err) {
    logger.error({ err: String(err), userId, resolvedProjectId }, "Deploy status check failed");
    res.status(500).json({ error: "Status check failed" });
  }
});

/**
 * GET /api/deploy/after-push
 * Called immediately after a FILE_EDIT GitHub push succeeds.
 * If the user has no Vercel connection, returns { hasVercel: false } immediately.
 * If they do, polls Vercel every 5 s for up to 90 s until the latest deployment
 * reaches "ready" or "failed", then returns the result.
 * Query: ?projectId=...&teamId=...&atlasProjectId=... (projectId/teamId optional — fall back to connection metadata;
 *         atlasProjectId is our internal DB project ID — when provided, auto-registers a daily scheduled
 *         health check for the deployed URL after a successful deploy; idempotent)
 */
router.get("/deploy/after-push", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = req.query.projectId as string | undefined;
  const teamId = req.query.teamId as string | undefined;
  // atlasProjectId is our internal DB project ID — used to auto-register a health check
  const atlasProjectIdRaw = req.query.atlasProjectId as string | undefined;
  const atlasProjectId = atlasProjectIdRaw ? parseInt(atlasProjectIdRaw, 10) : null;

  const [connection] = await db
    .select()
    .from(connectionsTable)
    .where(and(eq(connectionsTable.userId, userId), eq(connectionsTable.type, "vercel")))
    .orderBy(desc(connectionsTable.createdAt))
    .limit(1);

  if (!connection?.token) {
    res.json({ hasVercel: false });
    return;
  }

  const token = decryptToken(connection.token);
  const resolvedProjectId =
    projectId ??
    ((connection.metadata as Record<string, unknown>)?.projectId as string | undefined) ??
    null;
  const resolvedTeamId =
    teamId ??
    ((connection.metadata as Record<string, unknown>)?.teamId as string | undefined) ??
    null;

  if (!resolvedProjectId) {
    res.json({ hasVercel: false, reason: "No Vercel projectId configured" });
    return;
  }

  const statusUrl = resolvedTeamId
    ? `https://api.vercel.com/v6/deployments?projectId=${resolvedProjectId}&teamId=${resolvedTeamId}&limit=1`
    : `https://api.vercel.com/v6/deployments?projectId=${resolvedProjectId}&limit=1`;

  const POLL_INTERVAL_MS = 5000;
  const MAX_POLLS = 18; // 18 × 5 s = 90 s max wait

  const poll = async (): Promise<{
    status: "ready" | "failed" | "building" | "pending" | "timeout";
    url?: string;
    alias?: string;
    deploymentId?: string;
  }> => {
    for (let i = 0; i < MAX_POLLS; i++) {
      if (i > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      try {
        const r = await fetch(statusUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) continue;

        const data = await r.json() as {
          deployments?: Array<{
            id?: string;
            url?: string;
            state?: string;
            readyState?: string;
            alias?: string[];
          }>;
        };

        const deploy = data.deployments?.[0];
        if (!deploy) continue;

        const raw = (deploy.state ?? deploy.readyState ?? "").toLowerCase();
        if (raw.includes("ready") || raw.includes("completed")) {
          return {
            status: "ready",
            deploymentId: deploy.id,
            url: deploy.url,
            alias: deploy.alias?.[0],
          };
        }
        if (raw.includes("error") || raw.includes("failed") || raw.includes("canceled")) {
          return { status: "failed", deploymentId: deploy.id };
        }
        // still building — keep polling
      } catch {
        // transient error — keep polling
      }
    }
    return { status: "timeout" };
  };

  try {
    const result = await poll();

    // When deploy is ready and we have a URL, auto-run visual QA health check
    let visualQa: { isHealthy: boolean; issues: string[]; analysis?: string; screenshotBase64?: string } | null = null;
    let autoMonitoringSetUp = false;

    if (result.status === "ready" && (result.alias ?? result.url)) {
      const liveUrl = result.alias ? `https://${result.alias}` : `https://${result.url}`;

      // Visual QA one-shot health check
      try {
        const healthRes = await fetch(
          `${req.protocol}://${req.get("host")}/api/browser/health`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: req.headers.cookie ?? "" },
            body: JSON.stringify({ url: liveUrl }),
            signal: AbortSignal.timeout(60_000),
          }
        );
        if (healthRes.ok) {
          visualQa = await healthRes.json() as typeof visualQa;
        }
      } catch (err) {
        logger.warn({ err: String(err), liveUrl }, "Post-deploy visual QA failed — continuing without it");
      }

      // Release checkpoint — fire and forget (once per project)
      if (atlasProjectId && !isNaN(atlasProjectId)) {
        void createAutoCheckpointOnce({
          projectId: atlasProjectId,
          type: "release",
          label: "First deploy live",
          title: "Project deployed to production",
          notes: result.alias ? `Live at https://${result.alias}` : result.url ? `Live at https://${result.url}` : undefined,
          createdBy: "system",
          metadata: { deploymentId: result.deploymentId ?? null, url: result.url ?? null, alias: result.alias ?? null },
        });
      }

      // Auto-register a scheduled health check against the project's canonical previewUrl
      if (atlasProjectId && !isNaN(atlasProjectId)) {
        try {
          // Load the project scoped to this user (ownership check)
          const [project] = await db
            .select({ id: projectsTable.id, previewUrl: projectsTable.previewUrl })
            .from(projectsTable)
            .where(
              and(
                eq(projectsTable.id, atlasProjectId),
                eq(projectsTable.userId, userId)
              )
            )
            .limit(1);

          if (!project) {
            logger.warn({ atlasProjectId, userId }, "Auto health check skipped — project not found or not owned by user");
          } else if (!project.previewUrl) {
            logger.info({ atlasProjectId }, "Auto health check skipped — project has no previewUrl");
          } else {
            // Validate the URL is safe (SSRF guard, same as POST /api/browser/schedule)
            await assertSafeUrl(project.previewUrl);

            const existing = await db
              .select({ id: scheduledChecksTable.id, isActive: scheduledChecksTable.isActive })
              .from(scheduledChecksTable)
              .where(
                and(
                  eq(scheduledChecksTable.projectId, atlasProjectId),
                  eq(scheduledChecksTable.url, project.previewUrl),
                  eq(scheduledChecksTable.userId, userId)
                )
              )
              .limit(1);

            if (existing.length === 0) {
              // No check exists yet — create one
              await db.insert(scheduledChecksTable).values({
                userId,
                projectId: atlasProjectId,
                url: project.previewUrl,
                intervalMinutes: 1440,
                isActive: true,
                nextCheckAt: new Date(),
              });
              autoMonitoringSetUp = true;
              logger.info({ userId, atlasProjectId, previewUrl: project.previewUrl }, "Auto-registered health check after deploy");
            } else if (!existing[0]!.isActive) {
              // Check exists but was deactivated — reactivate it
              await db
                .update(scheduledChecksTable)
                .set({ isActive: true, nextCheckAt: new Date() })
                .where(eq(scheduledChecksTable.id, existing[0]!.id));
              autoMonitoringSetUp = true;
              logger.info({ userId, atlasProjectId, previewUrl: project.previewUrl }, "Reactivated health check after deploy");
            } else {
              // Check already exists and is active — monitoring already running
              autoMonitoringSetUp = true;
            }
          }
        } catch (err) {
          logger.warn({ err: String(err), atlasProjectId }, "Auto-register health check failed — continuing without it");
        }
      }
    }

    res.json({
      hasVercel: true,
      ...result,
      ...(visualQa ? { visualQa } : {}),
      ...(autoMonitoringSetUp ? { autoMonitoringSetUp: true, autoMonitoringMessage: "I've set up automatic monitoring for your app." } : {}),
    });
  } catch (err) {
    logger.error({ err: String(err), userId, resolvedProjectId }, "after-push poll failed");
    res.status(500).json({ error: "Deploy status poll failed" });
  }
});

export default router;
