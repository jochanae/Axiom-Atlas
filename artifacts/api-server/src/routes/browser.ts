import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import Anthropic from "@anthropic-ai/sdk";
import { db, scheduledChecksTable, checkResultsTable, projectsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ScreenshotBody = z.object({
  url: z.string().url(),
  fullPage: z.boolean().optional(),
  analyze: z.boolean().optional(),
});

const ScrapeBody = z.object({
  url: z.string().url(),
  selector: z.string().optional(),
  maxLength: z.number().int().min(100).max(50000).optional(),
  analyze: z.boolean().optional(),
});

const HealthBody = z.object({
  url: z.string().url(),
});

const MonitorBody = z.object({
  url: z.string().url(),
  checkResources: z.boolean().optional().default(true),
});

/**
 * POST /api/browser/screenshot
 * Screenshot a URL via Microlink (no API key needed).
 * Returns { imageUrl, screenshotBase64, url, analysis? } for Atlas to embed in chat.
 * Pass analyze:true to get an AI description of what the screenshot shows.
 */
router.post("/browser/screenshot", async (req, res): Promise<void> => {
  const parsed = ScreenshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { url, fullPage, analyze } = parsed.data;

  try {
    const mlUrl =
      `https://api.microlink.io/?url=${encodeURIComponent(url)}` +
      `&screenshot=true&fullPage=${fullPage ? "true" : "false"}&meta=false&embed=screenshot.url`;

    const mlRes = await fetch(mlUrl, {
      headers: { "User-Agent": "Atlas-Browser/1.0" },
      signal: AbortSignal.timeout(25_000),
    });

    if (!mlRes.ok) {
      res.status(502).json({ error: "Screenshot service failed" });
      return;
    }

    const mlData = await mlRes.json() as {
      status: string;
      data?: { screenshot?: { url?: string } };
    };
    const screenshotUrl = mlData?.data?.screenshot?.url;
    if (!screenshotUrl) {
      res.status(502).json({ error: "No screenshot returned" });
      return;
    }

    const imgRes = await fetch(screenshotUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) {
      res.status(502).json({ error: "Failed to download screenshot" });
      return;
    }

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const mediaType = contentType.includes("png") ? "image/png"
      : contentType.includes("gif") ? "image/gif"
      : contentType.includes("webp") ? "image/webp"
      : "image/jpeg";

    const screenshotBase64 = `data:${mediaType};base64,${buffer.toString("base64")}`;

    let analysis: string | null = null;
    if (analyze) {
      try {
        const visionResp = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 400,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                  data: buffer.toString("base64"),
                },
              },
              {
                type: "text",
                text: `You are doing a visual QA review of ${url}. Describe what you see in 2-4 sentences: layout, key content, visual health (does it look live and functional, or broken/empty/error state?). Be direct and specific.`,
              },
            ],
          }],
        });
        const textBlock = visionResp.content.find(b => b.type === "text");
        analysis = textBlock?.type === "text" ? textBlock.text.trim() : null;
      } catch (err) {
        logger.warn({ err, url }, "Screenshot AI analysis failed — returning screenshot without analysis");
      }
    }

    res.json({
      imageUrl: screenshotUrl,
      screenshotBase64,
      url,
      ...(analysis ? { analysis } : {}),
    });
  } catch (err) {
    logger.error({ err: String(err), url }, "Browser screenshot failed");
    res.status(500).json({ error: "Screenshot failed" });
  }
});

/**
 * POST /api/browser/scrape
 * Lightweight HTML fetch + text extraction.
 * Returns { title, text, headings[], links[], analysis? } for Atlas to analyze.
 * Pass analyze:true to get an AI product/competitor summary.
 */
router.post("/browser/scrape", async (req, res): Promise<void> => {
  const parsed = ScrapeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { url, selector, maxLength = 8000, analyze } = parsed.data;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Atlas/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      res.status(502).json({ error: `HTTP ${response.status}` });
      return;
    }

    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    const headingMatches = html.match(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>/gi) ?? [];
    const headings = headingMatches.map(h => h.replace(/<[^>]+>/g, "").trim()).filter(Boolean);

    const linkMatches = html.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi) ?? [];
    const links = linkMatches
      .map(a => {
        const hrefMatch = a.match(/href="([^"]+)"/);
        const textMatch = a.match(/>([^<]*)</);
        return hrefMatch && textMatch
          ? { href: hrefMatch[1], text: textMatch[1].trim() }
          : null;
      })
      .filter((l): l is { href: string; text: string } => !!l)
      .slice(0, 50);

    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (maxLength && text.length > maxLength) {
      text = text.slice(0, maxLength) + "\n\n[truncated]";
    }

    let analysis: string | null = null;
    if (analyze) {
      try {
        const excerpt = text.slice(0, 4000);
        const headingSummary = headings.slice(0, 10).join(" › ");
        const analysisResp = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `Analyze this product/page as a sharp strategic thinker. URL: ${url}\nTitle: ${title ?? "N/A"}\nHeadings: ${headingSummary || "none"}\n\nContent:\n${excerpt}\n\nIn 3-5 sentences: What does this product/page do? Who is it for? What's the value proposition? What stands out or is missing? Be direct and opinionated — this is for competitor research.`,
          }],
        });
        const textBlock = analysisResp.content.find(b => b.type === "text");
        analysis = textBlock?.type === "text" ? textBlock.text.trim() : null;
      } catch (err) {
        logger.warn({ err, url }, "Scrape AI analysis failed — returning raw content");
      }
    }

    res.json({
      url,
      title,
      text,
      headings: headings.slice(0, 30),
      links: links.slice(0, 30),
      selector: selector ?? null,
      ...(analysis ? { analysis } : {}),
    });
  } catch (err) {
    logger.error({ err: String(err), url }, "Browser scrape failed");
    res.status(500).json({ error: "Scrape failed" });
  }
});

/**
 * POST /api/browser/health
 * Comprehensive health check: HTTP status + screenshot + AI visual assessment.
 * Returns { url, httpStatus, isHealthy, issues[], screenshotBase64?, analysis? }.
 * Used by the Visual QA loop after deployment.
 */
router.post("/browser/health", async (req, res): Promise<void> => {
  const parsed = HealthBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { url } = parsed.data;

  const issues: string[] = [];
  let httpStatus: number | null = null;
  let screenshotBase64: string | null = null;
  let analysis: string | null = null;

  // 1. HTTP status check
  try {
    const headResp = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Atlas-HealthCheck/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = headResp.status;
    if (headResp.status >= 400) {
      issues.push(`HTTP ${headResp.status} — page returned an error status`);
    }
  } catch (err) {
    issues.push(`Unreachable: ${String(err).split("\n")[0]}`);
  }

  // 2. Screenshot + AI visual check (non-fatal)
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
            const mediaType = contentType.includes("png") ? "image/png" : "image/jpeg";
            screenshotBase64 = `data:${mediaType};base64,${buffer.toString("base64")}`;

            // AI visual assessment
            try {
              const visionResp = await anthropic.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 300,
                messages: [{
                  role: "user",
                  content: [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: mediaType as "image/jpeg" | "image/png",
                        data: buffer.toString("base64"),
                      },
                    },
                    {
                      type: "text",
                      text: `Health check for ${url}. Is this page rendering correctly? Look for: blank/white screen, error messages ("404", "500", "Something went wrong", "Application Error"), broken layout, missing content, or crash screens. Answer in 1-2 sentences. Start with HEALTHY or ISSUE.`,
                    },
                  ],
                }],
              });
              const textBlock = visionResp.content.find(b => b.type === "text");
              analysis = textBlock?.type === "text" ? textBlock.text.trim() : null;
              if (analysis && analysis.startsWith("ISSUE")) {
                issues.push(`Visual: ${analysis.replace(/^ISSUE:?\s*/i, "").trim()}`);
              }
            } catch (err) {
              logger.warn({ err, url }, "Health check AI analysis failed");
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, url }, "Health check screenshot failed — continuing");
    }
  }

  const isHealthy = issues.length === 0;
  res.json({
    url,
    httpStatus,
    isHealthy,
    issues,
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
    ...(analysis ? { analysis } : {}),
  });
});

/**
 * POST /api/browser/monitor
 * Live error capture — multi-signal page analysis without a headless browser.
 * Covers: HTTP errors, failed resource loads (JS/CSS 404s), HTML error patterns,
 * inline script console.error detection, and framework-specific crash overlays.
 * Returns { url, hasErrors, consoleErrors[], resourceErrors[], errorPatterns[], summary }.
 */
router.post("/browser/monitor", async (req, res): Promise<void> => {
  const parsed = MonitorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { url, checkResources } = parsed.data;

  const consoleErrors: string[] = [];
  const resourceErrors: string[] = [];
  const errorPatterns: string[] = [];
  let httpStatus: number | null = null;
  let pageContent = "";

  // ── 1. Fetch page HTML ──────────────────────────────────────────────────────
  try {
    const pageResp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Atlas-Monitor/1.0)", Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    httpStatus = pageResp.status;

    if (pageResp.status >= 400) {
      errorPatterns.push(`HTTP ${pageResp.status}: page returned an error status`);
    }

    if (pageResp.status < 400) {
      pageContent = await pageResp.text();
    }
  } catch (err) {
    errorPatterns.push(`Unreachable: ${String(err).split("\n")[0]}`);
  }

  if (pageContent) {
    // ── 2. Framework crash pattern detection ─────────────────────────────────
    const crashPatterns: Array<{ re: RegExp; label: string }> = [
      { re: /Minified React error #(\d+)/i, label: "React minified error" },
      { re: /Application error: a client-side exception has occurred/i, label: "Next.js application error" },
      { re: /ChunkLoadError/i, label: "Webpack chunk load failure" },
      { re: /__webpack_error__|__vite_error__/i, label: "Bundler error overlay" },
      { re: /window\.__SENTRY_REPLAY_ERROR__/i, label: "Sentry error capture" },
      { re: /<title[^>]*>[^<]*(404|not found|error|crashed|unavailable)[^<]*<\/title>/i, label: "Error in page title" },
      { re: /Something went wrong\./i, label: "Generic 'Something went wrong' UI" },
      { re: /Internal Server Error/i, label: "Internal Server Error in page body" },
      { re: /#error-boundary|class="error-boundary|id="error-boundary/i, label: "React error boundary rendered" },
      { re: /data-nextjs-dialog-overlay|__nextjs__toast/i, label: "Next.js error overlay active" },
      { re: /vite-error-overlay|plugin-vue-error/i, label: "Vite error overlay active" },
    ];
    for (const { re, label } of crashPatterns) {
      if (re.test(pageContent)) {
        errorPatterns.push(label);
      }
    }

    // ── 3. Inline script console.error / uncaught exception scanning ─────────
    const scriptTagRe = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch: RegExpExecArray | null;
    const consoleErrRe = /console\.(error|warn)\s*\(/gi;
    const throwRe = /\bthrow\s+new\s+Error\s*\(/gi;
    const uncaughtRe = /window\.(onerror|addEventListener)\s*[=(]/i;
    let inlineScriptCount = 0;

    while ((scriptMatch = scriptTagRe.exec(pageContent)) !== null && inlineScriptCount < 10) {
      inlineScriptCount++;
      const scriptBody = scriptMatch[1] ?? "";
      // Skip small utility scripts (< 200 chars) and minified bundles > 50KB
      if (scriptBody.length < 50 || scriptBody.length > 50_000) continue;

      const errCalls = scriptBody.match(consoleErrRe);
      if (errCalls && errCalls.length > 0) {
        // Distinguish deliberate production error logging from dev artifacts
        const snippet = scriptBody.slice(0, 300).replace(/\s+/g, " ").trim();
        consoleErrors.push(`Inline script calls console.error/warn (${errCalls.length}×): …${snippet.slice(0, 120)}…`);
      }
      if (throwRe.test(scriptBody)) {
        consoleErrors.push(`Inline script throws uncaught Error (may be in error handler)`);
        throwRe.lastIndex = 0;
      }
      if (uncaughtRe.test(scriptBody)) {
        consoleErrors.push(`Inline script registers window.onerror / uncaught exception handler`);
      }
    }

    // ── 4. Resource 404 check — JS/CSS bundles only ───────────────────────────
    if (checkResources) {
      const origin = new URL(url).origin;
      const resourceRe = /<(?:script|link)[^>]+(?:src|href)="([^"]+\.(js|css))"/gi;
      const resourceUrls = new Set<string>();
      let rm: RegExpExecArray | null;
      while ((rm = resourceRe.exec(pageContent)) !== null) {
        const href = rm[1];
        if (!href) continue;
        try {
          const resolved = new URL(href, origin).href;
          if (resolved.startsWith(origin)) resourceUrls.add(resolved);
        } catch { /* ignore invalid URLs */ }
      }

      // Check up to 12 resources in parallel
      const toCheck = [...resourceUrls].slice(0, 12);
      const results = await Promise.allSettled(
        toCheck.map(async (resUrl) => {
          const r = await fetch(resUrl, {
            method: "HEAD",
            headers: { "User-Agent": "Atlas-Monitor/1.0" },
            signal: AbortSignal.timeout(8_000),
          });
          return { resUrl, status: r.status };
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.status >= 400) {
          resourceErrors.push(`${result.value.status} — ${result.value.resUrl}`);
        } else if (result.status === "rejected") {
          resourceErrors.push(`Unreachable — ${toCheck[results.indexOf(result)]}`);
        }
      }
    }
  }

  // ── 5. AI synthesis ─────────────────────────────────────────────────────────
  const hasErrors = errorPatterns.length > 0 || resourceErrors.length > 0;
  const allSignals = [
    ...errorPatterns.map(p => `ERROR_PATTERN: ${p}`),
    ...consoleErrors.map(c => `CONSOLE_ERROR: ${c}`),
    ...resourceErrors.map(r => `RESOURCE_404: ${r}`),
  ];

  let summary = "";
  if (allSignals.length > 0) {
    try {
      const synthResp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 250,
        messages: [{
          role: "user",
          content: `Live error capture for ${url}. Signals detected:\n${allSignals.join("\n")}\n\nSummarize in 2-3 sentences for a developer: what's broken, what caused it, and what to check first. Be specific and direct.`,
        }],
      });
      const textBlock = synthResp.content.find(b => b.type === "text");
      summary = textBlock?.type === "text" ? textBlock.text.trim() : "";
    } catch (err) {
      logger.warn({ err, url }, "Monitor AI synthesis failed");
      summary = allSignals.join("; ");
    }
  } else {
    summary = `No errors detected on ${url}. Page loaded with HTTP ${httpStatus ?? "unknown"}, all checked resources returned 200, no crash patterns found.`;
  }

  res.json({
    url,
    httpStatus,
    hasErrors,
    consoleErrors,
    resourceErrors,
    errorPatterns,
    summary,
  });
});

const ScheduleBody = z.object({
  url: z.string().url(),
  projectId: z.number().int().positive(),
  intervalMinutes: z.number().int().min(5).max(10080).optional().default(1440),
});

/**
 * POST /api/browser/schedule
 * Register a URL for scheduled health checks.
 * Body: { url, projectId, intervalMinutes? }  (intervalMinutes default: 1440 = daily)
 * Returns the created scheduled_check row.
 */
router.post("/browser/schedule", async (req, res): Promise<void> => {
  const userId = (req as any).user?.id as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = ScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { url, projectId, intervalMinutes } = parsed.data;

  try {
    // Verify the project belongs to the authenticated user before scheduling
    const [ownedProject] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!ownedProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Schedule the first check immediately (nextCheckAt = now)
    const [row] = await db
      .insert(scheduledChecksTable)
      .values({
        userId,
        projectId,
        url,
        intervalMinutes,
        isActive: true,
        nextCheckAt: new Date(),
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err, url, projectId }, "Failed to create scheduled check");
    res.status(500).json({ error: "Failed to create scheduled check" });
  }
});

/**
 * DELETE /api/browser/schedule/:id
 * Deactivate (soft-delete) a scheduled check.
 */
router.delete("/browser/schedule/:id", async (req, res): Promise<void> => {
  const userId = (req as any).user?.id as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;

  try {
    const [row] = await db
      .update(scheduledChecksTable)
      .set({ isActive: false })
      .where(
        and(
          eq(scheduledChecksTable.id, id),
          eq(scheduledChecksTable.userId, userId)
        )
      )
      .returning();

    if (!row) {
      res.status(404).json({ error: "Scheduled check not found" });
      return;
    }
    res.json({ ok: true, id: row.id });
  } catch (err) {
    logger.error({ err, id }, "Failed to deactivate scheduled check");
    res.status(500).json({ error: "Failed to deactivate scheduled check" });
  }
});

/**
 * GET /api/browser/checks/:projectId
 * Return recent check results + active scheduled checks for a project.
 * Query params: limit (default 20, max 100)
 */
router.get("/browser/checks/:projectId", async (req, res): Promise<void> => {
  const userId = (req as any).user?.id as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const projectId = parseInt(req.params.projectId ?? "", 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  const rawLimit = parseInt((req.query.limit as string) ?? "20", 10);
  const limit = Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100);

  try {
    // Verify project ownership before any reads
    const [ownedProject] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!ownedProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [schedules, results] = await Promise.all([
      db
        .select()
        .from(scheduledChecksTable)
        .where(
          and(
            eq(scheduledChecksTable.projectId, projectId),
            eq(scheduledChecksTable.userId, userId),
            eq(scheduledChecksTable.isActive, true)
          )
        )
        .orderBy(desc(scheduledChecksTable.createdAt)),
      // Scope results through user-owned schedules — prevents IDOR data leak
      db
        .select({
          id: checkResultsTable.id,
          scheduleId: checkResultsTable.scheduleId,
          projectId: checkResultsTable.projectId,
          url: checkResultsTable.url,
          httpStatus: checkResultsTable.httpStatus,
          isHealthy: checkResultsTable.isHealthy,
          issues: checkResultsTable.issues,
          analysis: checkResultsTable.analysis,
          checkedAt: checkResultsTable.checkedAt,
        })
        .from(checkResultsTable)
        .innerJoin(
          scheduledChecksTable,
          and(
            eq(checkResultsTable.scheduleId, scheduledChecksTable.id),
            eq(scheduledChecksTable.userId, userId)
          )
        )
        .where(eq(checkResultsTable.projectId, projectId))
        .orderBy(desc(checkResultsTable.checkedAt))
        .limit(limit),
    ]);

    // Compute a simple health summary for Atlas
    const totalChecks = results.length;
    const healthyChecks = results.filter(r => r.isHealthy).length;
    const lastResult = results[0] ?? null;

    let healthSummary: string;
    if (totalChecks === 0) {
      healthSummary = "No checks run yet.";
    } else {
      const lastCheckedAt = lastResult?.checkedAt;
      const daysSinceLast = lastCheckedAt
        ? Math.round((Date.now() - new Date(lastCheckedAt).getTime()) / 86_400_000)
        : null;
      const streakLabel =
        healthyChecks === totalChecks
          ? `healthy for all ${totalChecks} check${totalChecks !== 1 ? "s" : ""}`
          : `${healthyChecks}/${totalChecks} checks healthy`;
      const recencyLabel = daysSinceLast != null
        ? daysSinceLast === 0 ? ", last checked today" : `, last checked ${daysSinceLast}d ago`
        : "";
      healthSummary = `App is ${streakLabel}${recencyLabel}.`;
    }

    res.json({
      schedules,
      results,
      summary: healthSummary,
    });
  } catch (err) {
    logger.error({ err, projectId }, "Failed to fetch check results");
    res.status(500).json({ error: "Failed to fetch check results" });
  }
});

export default router;
