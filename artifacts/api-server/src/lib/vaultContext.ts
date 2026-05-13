/**
 * vaultContext.ts
 *
 * Fetches a project's Visual Vault images from GCS and returns them as:
 *   - Claude vision blocks (base64) for the message content
 *   - A short text summary for injection into the system prompt
 *
 * Cap: 10 images max per request — covers a full mobile page flow.
 */

import { db, galleryImagesTable } from "@workspace/db";
import { eq, and, isNull, asc } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

const storage = new ObjectStorageService();
const MAX_VAULT_IMAGES = 10;

export interface VaultImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
}

export interface VaultContext {
  /** Vision blocks to prepend to the user message content */
  imageBlocks: VaultImageBlock[];
  /** Short summary line for the system prompt */
  systemNote: string;
  /** True if any images were found */
  hasImages: boolean;
}

/**
 * Load vault context for a given user + project (or global if projectId is null).
 * Never throws — returns empty context on any error so the chat always proceeds.
 */
export async function loadVaultContext(
  userId: number,
  projectId: number | null
): Promise<VaultContext> {
  const empty: VaultContext = { imageBlocks: [], systemNote: "", hasImages: false };

  try {
    // Fetch images oldest-first so sequential page-flow screenshots read top→bottom
    const rows = projectId
      ? await db
          .select()
          .from(galleryImagesTable)
          .where(and(eq(galleryImagesTable.userId, userId), eq(galleryImagesTable.projectId, projectId)))
          .orderBy(asc(galleryImagesTable.createdAt))
          .limit(MAX_VAULT_IMAGES)
      : await db
          .select()
          .from(galleryImagesTable)
          .where(and(eq(galleryImagesTable.userId, userId), isNull(galleryImagesTable.projectId)))
          .orderBy(asc(galleryImagesTable.createdAt))
          .limit(MAX_VAULT_IMAGES);

    if (rows.length === 0) return empty;

    // Download each image from GCS as a Buffer → base64
    const blocks: VaultImageBlock[] = [];
    const labels: string[] = [];

    for (const row of rows) {
      try {
        const file = await storage.getObjectEntityFile(row.objectPath);
        const [buffer] = await file.download();
        // Detect MIME type from first bytes (magic numbers)
        const mime = detectMimeType(buffer);
        if (!mime) continue;
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mime,
            data: buffer.toString("base64"),
          },
        });
        labels.push(row.label ?? row.objectPath.split("/").pop() ?? "image");
      } catch (err) {
        if (err instanceof ObjectNotFoundError) continue;
        // Skip silently on download failure — don't break the chat
      }
    }

    if (blocks.length === 0) return empty;

    const scope = projectId ? "this project" : "your global vault";
    const systemNote =
      `VISUAL VAULT — The user has ${blocks.length} saved screenshot${blocks.length > 1 ? "s" : ""} ` +
      `in ${scope}: ${labels.join(", ")}. ` +
      `These images are included in this message. Review them with a strategic lens — ` +
      `notice UI patterns, gaps, inconsistencies, or opportunities without being asked. ` +
      `If you spot something significant, mention it briefly.`;

    return { imageBlocks: blocks, systemNote, hasImages: true };
  } catch {
    return empty;
  }
}

/** Detect image MIME type from magic bytes */
function detectMimeType(
  buf: Buffer
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  // Default to JPEG for undetected types — most screenshots are JPEG
  return "image/jpeg";
}
