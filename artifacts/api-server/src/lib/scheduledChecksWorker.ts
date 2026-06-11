/**
 * scheduledChecksWorker
 *
 * Background worker that runs health checks on schedule.
 * Polls every 60 seconds, finds any scheduled_checks whose next_check_at is due,
 * runs a lightweight HTTP + screenshot health check against each URL,
 * stores the result in check_results, and advances next_check_at.
 *
 * Start it once after the server is listening:
 *   import { startScheduledChecksWorker } from "./lib/scheduledChecksWorker";
 *   startScheduledChecksWorker();
 */

import { db, scheduledChecksTable, checkResultsTable } from "@workspace/db";
import { lte, eq, and } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 60_000;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function runHealthCheck(url: string): Promise<{
  httpStatus: number | null;
  isHealthy: boolean;
  issues: string[];
  analysis: string | null;
}> {
  const issues: string[] = [];
  let httpStatus: number | null = null;
  let screenshotBase64: string | null = null;
  let analysis: string | null = null;

  // 1. HTTP status
  try {
    const headResp = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Atlas-ScheduledCheck/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = headResp.status;
    if (headResp.status >= 400) {
      issues.push(`HTTP ${headResp.status}`);
    }
  } catch (err) {
    issues.push(`Unreachable: ${String(err).split("\n")[0]}`);
  }

  // 2. Screenshot + AI visual check (non-fatal — skip if HTTP already bad)
  if (httpStatus == null || httpStatus < 400) {
    try {
      const mlUrl =
        `https://api.microlink.io/?url=${encodeURIComponent(url)}` +
        `&screenshot=true&fullPage=false&meta=false&embed=screenshot.url`;

      const mlRes = await fetch(mlUrl, {
        headers: { "User-Agent": "Atlas-Browser/1.0" },
        signal: AbortSignal.timeout(25_000),
      });

      if (mlRes.ok) {
        const mlData = await mlRes.json() as {
          data?: { screenshot?: { url?: string } };
        };
        const screenshotUrl = mlData?.data?.screenshot?.url;
        if (screenshotUrl) {
          const imgRes = await fetch(screenshotUrl, { signal: AbortSignal.timeout(15_000) });
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
            const mediaType = contentType.includes("png") ? "image/png" as const : "image/jpeg" as const;
            screenshotBase64 = `data:${mediaType};base64,${buffer.toString("base64")}`;

            try {
              const visionResp = await anthropic.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 200,
                messages: [{
                  role: "user",
                  content: [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: mediaType,
                        data: buffer.toString("base64"),
                      },
                    },
                    {
                      type: "text",
                      text: `Scheduled health check for ${url}. Is this page rendering correctly? Look for blank screens, error messages (404, 500, "Something went wrong", "Application Error"), broken layout, or crash overlays. Answer in 1-2 sentences. Start with HEALTHY or ISSUE.`,
                    },
                  ],
                }],
              });
              const textBlock = visionResp.content.find(b => b.type === "text");
              analysis = textBlock?.type === "text" ? textBlock.text.trim() : null;
              if (analysis?.startsWith("ISSUE")) {
                issues.push(`Visual: ${analysis.replace(/^ISSUE:?\s*/i, "").trim()}`);
              }
            } catch (err) {
              logger.warn({ err, url }, "Scheduled check AI visual analysis failed");
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, url }, "Scheduled check screenshot failed — continuing");
    }
  }

  // Suppress unused variable warning
  void screenshotBase64;

  return {
    httpStatus,
    isHealthy: issues.length === 0,
    issues,
    analysis,
  };
}

async function runDueChecks(): Promise<void> {
  const now = new Date();

  let dueChecks: Array<{
    id: string;
    projectId: number;
    url: string;
    intervalMinutes: number;
  }>;

  try {
    dueChecks = await db
      .select({
        id: scheduledChecksTable.id,
        projectId: scheduledChecksTable.projectId,
        url: scheduledChecksTable.url,
        intervalMinutes: scheduledChecksTable.intervalMinutes,
      })
      .from(scheduledChecksTable)
      .where(
        and(
          eq(scheduledChecksTable.isActive, true),
          lte(scheduledChecksTable.nextCheckAt, now)
        )
      );
  } catch (err) {
    logger.warn({ err }, "Scheduled checks worker: failed to query due checks");
    return;
  }

  if (dueChecks.length === 0) return;

  logger.info({ count: dueChecks.length }, "Scheduled checks worker: running due checks");

  await Promise.allSettled(
    dueChecks.map(async (check) => {
      try {
        const result = await runHealthCheck(check.url);

        await db.insert(checkResultsTable).values({
          scheduleId: check.id,
          projectId: check.projectId,
          url: check.url,
          httpStatus: result.httpStatus,
          isHealthy: result.isHealthy,
          issues: result.issues,
          analysis: result.analysis,
        });

        const nextCheckAt = new Date(now.getTime() + check.intervalMinutes * 60_000);
        await db
          .update(scheduledChecksTable)
          .set({ lastCheckedAt: now, nextCheckAt })
          .where(eq(scheduledChecksTable.id, check.id));

        logger.info(
          { url: check.url, isHealthy: result.isHealthy, issues: result.issues },
          "Scheduled check completed"
        );
      } catch (err) {
        logger.error({ err, checkId: check.id, url: check.url }, "Scheduled check run failed");
      }
    })
  );
}

let workerHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduledChecksWorker(): void {
  if (workerHandle) return;
  logger.info("Scheduled checks worker: starting (poll interval 60s)");
  // Run once immediately on start (catches any checks that became due while server was down)
  runDueChecks().catch((err) => logger.error({ err }, "Scheduled checks worker: initial run failed"));
  workerHandle = setInterval(() => {
    runDueChecks().catch((err) => logger.error({ err }, "Scheduled checks worker: poll failed"));
  }, POLL_INTERVAL_MS);
}

export function stopScheduledChecksWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
    logger.info("Scheduled checks worker: stopped");
  }
}
