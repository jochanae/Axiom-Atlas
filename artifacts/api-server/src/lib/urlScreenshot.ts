/**
 * urlScreenshot.ts
 *
 * Detects URLs in a chat message, screenshots them via Microlink (no API key),
 * and returns base64 image blocks ready for Claude vision or Gemini inlineData.
 *
 * Falls back to text scrape (title + description + body excerpt) when screenshot fails.
 * Also detects known deployment platforms from the URL itself.
 *
 * Rules:
 *  - Max 3 URLs per message (avoids blowing token budget)
 *  - Skips bare image URLs (.png/.jpg/.gif/.webp/.svg) — those aren't pages
 *  - Never throws — returns [] on any failure so the chat always continues
 *  - 25 s timeout per screenshot, 10 s for text scrape
 */

export interface UrlImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
  url: string;
  platform?: string;
}

export interface UrlTextBlock {
  type: "url_text";
  url: string;
  title?: string;
  description?: string;
  excerpt?: string;
  platform?: string;
}

export type UrlBlock = UrlImageBlock | UrlTextBlock;

const URL_REGEX = /https?:\/\/[^\s<>"'()[\]{}\\]+/g;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)(\?.*)?$/i;
const MAX_URLS = 3;

// ── Platform detection ────────────────────────────────────────────────────────

const PLATFORM_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /vercel\.app/i,          name: "Vercel" },
  { pattern: /netlify\.app/i,         name: "Netlify" },
  { pattern: /railway\.app/i,         name: "Railway" },
  { pattern: /onrender\.com/i,        name: "Render" },
  { pattern: /fly\.dev/i,             name: "Fly.io" },
  { pattern: /repl\.co|replit\.app/i, name: "Replit" },
  { pattern: /run\.app/i,             name: "Google Cloud Run" },
  { pattern: /pages\.dev/i,           name: "Cloudflare Pages" },
  { pattern: /github\.io/i,           name: "GitHub Pages" },
  { pattern: /herokuapp\.com/i,       name: "Heroku" },
  { pattern: /azurewebsites\.net/i,   name: "Azure" },
  { pattern: /amplifyapp\.com/i,      name: "AWS Amplify" },
  { pattern: /supabase\.co/i,         name: "Supabase" },
  { pattern: /planetscale\.com/i,     name: "PlanetScale" },
  { pattern: /neon\.tech/i,           name: "Neon" },
];

function detectPlatform(url: string): string | undefined {
  for (const { pattern, name } of PLATFORM_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return undefined;
}

// ── URL extraction ────────────────────────────────────────────────────────────

export function extractPageUrls(text: string): string[] {
  const found = text.match(URL_REGEX) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const url = raw.replace(/[.,;:!?)]+$/, "");
    if (IMAGE_EXT.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_URLS) break;
  }
  return out;
}

// ── Text scrape fallback ──────────────────────────────────────────────────────

async function scrapeTextFallback(url: string): Promise<UrlTextBlock | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Atlas-Chat/1.0)",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    const title = titleMatch?.[1]?.trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

    // Extract meta description (og or standard)
    const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,400})["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']{1,400})["'][^>]+property=["']og:description["']/i);
    const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']{1,400})["'][^>]+name=["']description["']/i);
    const description = ogDescMatch?.[1]?.trim() ?? metaDescMatch?.[1]?.trim();

    // Extract first meaningful paragraph text as excerpt
    const bodyMatch = html.replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const excerpt = bodyMatch.slice(0, 500) || undefined;

    if (!title && !description && !excerpt) return null;

    return {
      type: "url_text",
      url,
      title,
      description,
      excerpt,
      platform: detectPlatform(url),
    };
  } catch {
    return null;
  }
}

// ── Screenshot via Microlink ──────────────────────────────────────────────────

export async function screenshotUrlsToBlocks(urls: string[]): Promise<UrlBlock[]> {
  if (!urls.length) return [];

  const blocks: UrlBlock[] = [];

  await Promise.all(
    urls.map(async (url) => {
      const platform = detectPlatform(url);

      try {
        const mlUrl =
          `https://api.microlink.io/?url=${encodeURIComponent(url)}` +
          `&screenshot=true&fullPage=false&meta=false&embed=screenshot.url`;

        const mlRes = await fetch(mlUrl, {
          headers: { "User-Agent": "Atlas-Chat/1.0" },
          signal: AbortSignal.timeout(25_000),
        });

        if (!mlRes.ok) throw new Error(`Microlink ${mlRes.status}`);

        const mlData = await mlRes.json() as {
          status: string;
          data?: { screenshot?: { url?: string } };
        };

        const screenshotUrl = mlData?.data?.screenshot?.url;
        if (!screenshotUrl) throw new Error("No screenshot URL");

        const imgRes = await fetch(screenshotUrl, { signal: AbortSignal.timeout(15_000) });
        if (!imgRes.ok) throw new Error(`Image fetch ${imgRes.status}`);

        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
        const mediaType = contentType.includes("png") ? "image/png"
          : contentType.includes("gif") ? "image/gif"
          : contentType.includes("webp") ? "image/webp"
          : "image/jpeg";

        blocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
          url,
          platform,
        });
      } catch {
        // Screenshot failed — try text scrape as fallback
        const textBlock = await scrapeTextFallback(url);
        if (textBlock) {
          if (platform) textBlock.platform = platform;
          blocks.push(textBlock);
        }
        // If both fail, silently skip — chat continues unaffected
      }
    })
  );

  return blocks;
}

// ── System prompt note ────────────────────────────────────────────────────────

export function buildUrlNote(blocks: UrlBlock[]): string {
  if (!blocks.length) return "";

  const parts: string[] = [];

  for (const block of blocks) {
    const platformTag = block.platform ? ` [${block.platform}]` : "";
    if (block.type === "image") {
      parts.push(`• ${block.url}${platformTag} — full-page screenshot captured and included as an image. Reference the visual layout, design, and content when responding.`);
    } else {
      const lines: string[] = [`• ${block.url}${platformTag} — screenshot unavailable, text extracted:`];
      if (block.title) lines.push(`  Title: ${block.title}`);
      if (block.description) lines.push(`  Description: ${block.description}`);
      if (block.excerpt) lines.push(`  Content excerpt: ${block.excerpt.slice(0, 300)}...`);
      parts.push(lines.join("\n"));
    }
  }

  const imageCount = blocks.filter((b) => b.type === "image").length;
  const textCount = blocks.filter((b) => b.type === "url_text").length;

  const summary = [
    imageCount > 0 ? `${imageCount} screenshot${imageCount > 1 ? "s" : ""} captured` : "",
    textCount > 0 ? `${textCount} page${textCount > 1 ? "s" : ""} scraped (text only)` : "",
  ].filter(Boolean).join(", ");

  return `LIVE URL CAPTURE (${summary}):\n${parts.join("\n")}\nWhen a platform is detected (e.g. Vercel, Cloud Run), factor in its deployment characteristics when advising.`;
}
