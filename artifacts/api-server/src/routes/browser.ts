import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ScreenshotBody = z.object({
  url: z.string().url(),
  fullPage: z.boolean().optional(),
});

const ScrapeBody = z.object({
  url: z.string().url(),
  selector: z.string().optional(),
  maxLength: z.number().int().min(100).max(50000).optional(),
});

/**
 * POST /api/browser/screenshot
 * Screenshot a URL via Microlink (no API key needed).
 * Returns { imageUrl, screenshotBase64 } for Atlas to embed in chat.
 */
router.post("/browser/screenshot", async (req, res): Promise<void> => {
  const parsed = ScreenshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { url, fullPage } = parsed.data;

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

    res.json({
      imageUrl: screenshotUrl,
      screenshotBase64: `data:${mediaType};base64,${buffer.toString("base64")}`,
      url,
    });
  } catch (err) {
    logger.error({ err: String(err), url }, "Browser screenshot failed");
    res.status(500).json({ error: "Screenshot failed" });
  }
});

/**
 * POST /api/browser/scrape
 * Lightweight HTML fetch + text extraction. No puppeteer/playwright needed.
 * Returns { title, text, headings[], links[] } for Atlas to analyze.
 */
router.post("/browser/scrape", async (req, res): Promise<void> => {
  const parsed = ScrapeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { url, selector, maxLength = 8000 } = parsed.data;

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

    // Lightweight extraction via regex (no DOM dependency)
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

    // Strip tags for plain text
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (maxLength && text.length > maxLength) {
      text = text.slice(0, maxLength) + "\n\n[truncated]";
    }

    res.json({
      url,
      title,
      text,
      headings: headings.slice(0, 30),
      links: links.slice(0, 30),
      selector: selector ?? null,
    });
  } catch (err) {
    logger.error({ err: String(err), url }, "Browser scrape failed");
    res.status(500).json({ error: "Scrape failed" });
  }
});

export default router;
