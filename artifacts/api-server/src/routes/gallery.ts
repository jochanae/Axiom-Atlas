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
