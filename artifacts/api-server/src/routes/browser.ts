import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import Anthropic from "@anthropic-ai/sdk";
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

export default router;
