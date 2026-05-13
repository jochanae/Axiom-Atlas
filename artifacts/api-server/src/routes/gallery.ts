import { Router, type IRouter } from "express";
import { db, galleryImagesTable } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

// GET /gallery — list images (global or per-project)
router.get("/gallery", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = req.query.projectId ? Number(req.query.projectId) : null;

    const rows = projectId
      ? await db
          .select()
          .from(galleryImagesTable)
          .where(and(eq(galleryImagesTable.userId, userId), eq(galleryImagesTable.projectId, projectId)))
          .orderBy(desc(galleryImagesTable.createdAt))
      : await db
          .select()
          .from(galleryImagesTable)
          .where(and(eq(galleryImagesTable.userId, userId), isNull(galleryImagesTable.projectId)))
          .orderBy(desc(galleryImagesTable.createdAt));

    res.json({ images: rows });
  } catch (err) {
    req.log.error({ err }, "gallery GET error");
    res.status(500).json({ error: "Failed to load gallery" });
  }
});

// POST /gallery/request-url — get a presigned upload URL
router.post("/gallery/request-url", async (req, res): Promise<void> => {
  try {
    const { name, size, contentType } = req.body as { name: string; size: number; contentType: string };
    if (!name || !contentType) {
      res.status(400).json({ error: "name and contentType required" });
      return;
    }
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error({ err }, "gallery request-url error");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// POST /gallery — save a gallery image record after upload
router.post("/gallery", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const { objectPath, label, projectId } = req.body as { objectPath: string; label?: string; projectId?: number | null };
    if (!objectPath) {
      res.status(400).json({ error: "objectPath required" });
      return;
    }
    const [row] = await db
      .insert(galleryImagesTable)
      .values({ userId, projectId: projectId ?? null, objectPath, label: label ?? null })
      .returning();
    res.json({ image: row });
  } catch (err) {
    req.log.error({ err }, "gallery POST error");
    res.status(500).json({ error: "Failed to save gallery image" });
  }
});

// POST /gallery/screenshot — capture a URL as a full-page screenshot → vault
router.post("/gallery/screenshot", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const { url, projectId, label } = req.body as { url: string; projectId?: number | null; label?: string };

    if (!url || !url.startsWith("http")) {
      res.status(400).json({ error: "Valid URL required (must start with http)" });
      return;
    }

    // 1. Call Microlink screenshot API (free, no key needed)
    const microlinkURL =
      `https://api.microlink.io/?url=${encodeURIComponent(url)}` +
      `&screenshot=true&fullPage=true&meta=false&embed=screenshot.url`;

    const mlRes = await fetch(microlinkURL, {
      headers: { "User-Agent": "Atlas-Vault/1.0" },
      signal: AbortSignal.timeout(30_000),
    });

    if (!mlRes.ok) {
      res.status(502).json({ error: "Screenshot service unavailable — try again shortly" });
      return;
    }

    const mlData = await mlRes.json() as {
      status: string;
      data?: { screenshot?: { url?: string; type?: string } };
    };

    const screenshotUrl = mlData?.data?.screenshot?.url;
    if (!screenshotUrl) {
      res.status(502).json({ error: "Could not capture screenshot for that URL — check that it's publicly accessible" });
      return;
    }

    // 2. Download the screenshot image as a Buffer
    const imgRes = await fetch(screenshotUrl, { signal: AbortSignal.timeout(20_000) });
    if (!imgRes.ok) {
      res.status(502).json({ error: "Failed to download screenshot" });
      return;
    }
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") || "image/png";

    // 3. Get a presigned PUT URL from GCS (same path as client-upload flow)
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);

    // 4. PUT the image buffer directly to GCS
    const putRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: imgBuffer,
      signal: AbortSignal.timeout(30_000),
    });
    if (!putRes.ok) {
      res.status(502).json({ error: "Failed to store screenshot" });
      return;
    }

    // 5. Save the DB record
    const hostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
    const [row] = await db
      .insert(galleryImagesTable)
      .values({
        userId,
        projectId: projectId ?? null,
        objectPath,
        label: label ?? hostname,
      })
      .returning();

    res.json({ image: row });
  } catch (err) {
    req.log.error({ err }, "gallery screenshot error");
    res.status(500).json({ error: "Screenshot failed" });
  }
});

// DELETE /gallery/:id
router.delete("/gallery/:id", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const id = Number(req.params.id);
    await db
      .delete(galleryImagesTable)
      .where(and(eq(galleryImagesTable.id, id), eq(galleryImagesTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "gallery DELETE error");
    res.status(500).json({ error: "Failed to delete gallery image" });
  }
});

export default router;
