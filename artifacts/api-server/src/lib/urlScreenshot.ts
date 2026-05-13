/**
 * urlScreenshot.ts
 *
 * Detects URLs in a chat message, screenshots them via Microlink (no API key),
 * and returns base64 image blocks ready for Claude vision or Gemini inlineData.
 *
 * Rules:
 *  - Max 3 URLs per message (avoids blowing token budget)
 *  - Skips bare image URLs (.png/.jpg/.gif/.webp/.svg) — those aren't pages
 *  - Never throws — returns [] on any failure so the chat always continues
 *  - 25 s timeout per screenshot
 */

export interface UrlImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
  /** The original URL this screenshot came from */
  url: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"'()[\]{}\\]+/g;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)(\?.*)?$/i;
const MAX_URLS = 3;

/**
 * Pull all unique http/https URLs from a message string,
 * excluding bare image file URLs.
 */
export function extractPageUrls(text: string): string[] {
  const found = text.match(URL_REGEX) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    // Strip trailing punctuation that's likely not part of the URL
    const url = raw.replace(/[.,;:!?)]+$/, "");
    if (IMAGE_EXT.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_URLS) break;
  }
  return out;
}

/**
 * Screenshot each URL via Microlink → download → base64.
 * Returns one block per successful screenshot (failed URLs are silently skipped).
 */
export async function screenshotUrlsToBlocks(urls: string[]): Promise<UrlImageBlock[]> {
  if (!urls.length) return [];

  const blocks: UrlImageBlock[] = [];

  await Promise.all(
    urls.map(async (url) => {
      try {
        const mlUrl =
          `https://api.microlink.io/?url=${encodeURIComponent(url)}` +
          `&screenshot=true&fullPage=false&meta=false&embed=screenshot.url`;

        const mlRes = await fetch(mlUrl, {
          headers: { "User-Agent": "Atlas-Chat/1.0" },
          signal: AbortSignal.timeout(25_000),
        });

        if (!mlRes.ok) return;

        const mlData = await mlRes.json() as {
          status: string;
          data?: { screenshot?: { url?: string } };
        };

        const screenshotUrl = mlData?.data?.screenshot?.url;
        if (!screenshotUrl) return;

        const imgRes = await fetch(screenshotUrl, { signal: AbortSignal.timeout(15_000) });
        if (!imgRes.ok) return;

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
        });
      } catch {
        // Silent — never break the chat over a screenshot failure
      }
    })
  );

  return blocks;
}

/**
 * Build a short system-prompt note listing which URLs were captured,
 * so Atlas knows what it's looking at without being told.
 */
export function buildUrlNote(blocks: UrlImageBlock[]): string {
  if (!blocks.length) return "";
  const list = blocks.map((b) => b.url).join(", ");
  return (
    `LIVE URL CAPTURE — The user's message contained ${blocks.length > 1 ? "these URLs" : "a URL"}: ${list}. ` +
    `Full-page screenshot${blocks.length > 1 ? "s were" : " was"} captured and included as image${blocks.length > 1 ? "s" : ""} in this message. ` +
    `Reference the visual when responding — note layout, content, design, or anything strategically relevant.`
  );
}
