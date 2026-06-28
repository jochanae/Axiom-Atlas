import { Router, type IRouter } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, projectZipImportsTable } from "@workspace/db";
import JSZip from "jszip";
import { z } from "zod/v4";

const router: IRouter = Router();

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".venv", "venv", ".cache", "coverage", ".nyc_output"]);
const TEXT_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "cpp", "h", "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "html", "htm", "css", "scss", "sass", "less", "json", "yaml", "yml", "toml", "xml", "md", "mdx", "txt", "env", "gitignore", "dockerignore", "sql", "graphql", "gql", "prisma", "tf", "hcl", "vue", "svelte"]);
const MAX_LINES_PER_FILE = 300;
const MAX_TOTAL_CHARS = 120_000;

function shouldSkip(path: string): boolean {
  const parts = path.split("/");
  return parts.some(p => SKIP_DIRS.has(p) || p.startsWith(".") && p !== ".env" && p !== ".gitignore");
}

function isText(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext);
}

type ZipFileEntry = { path: string; lines: number; truncated: boolean };

async function parseZipBuffer(buffer: Buffer, fileName: string): Promise<{
  entries: ZipFileEntry[];
  fullContext: string;
  truncated: boolean;
}> {
  const zip = await JSZip.loadAsync(buffer);

  const results: Array<ZipFileEntry & { content: string }> = [];

  await Promise.all(
    Object.keys(zip.files).map(async (rawPath) => {
      const path = rawPath.replace(/^[^/]+\//, "");
      if (!path) return;
      const entry = zip.files[rawPath];
      if (entry.dir) return;
      if (shouldSkip(path)) return;
      if (!isText(path)) return;
      try {
        const raw = await entry.async("text");
        const lines = raw.split("\n");
        const truncated = lines.length > MAX_LINES_PER_FILE;
        const content = truncated
          ? lines.slice(0, MAX_LINES_PER_FILE).join("\n") + "\n… (truncated)"
          : raw;
        results.push({ path, content, lines: lines.length, truncated });
      } catch {
        // binary / encoding error — skip
      }
    })
  );

  results.sort((a, b) => a.path.localeCompare(b.path));

  const totalChars = results.reduce((s, e) => s + e.content.length, 0);
  const globalTruncated = totalChars > MAX_TOTAL_CHARS;

  let accumulated = 0;
  const selected: typeof results = [];
  for (const e of results) {
    if (accumulated + e.content.length > MAX_TOTAL_CHARS) break;
    selected.push(e);
    accumulated += e.content.length;
  }

  const blocks = selected.map(e => `=== ${e.path} (${e.lines} lines) ===\n${e.content}`);
  const fullContext = `[ZIP: ${fileName} — ${selected.length} file${selected.length === 1 ? "" : "s"}]\n\n${blocks.join("\n\n")}`;

  const entries: ZipFileEntry[] = results.map(({ path, lines, truncated }) => ({ path, lines, truncated }));

  return { entries, fullContext, truncated: globalTruncated };
}

// GET /projects/:id/zip-import — fetch current import for this project
router.get("/projects/:id/zip-import", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project || project.userId !== userId) { res.status(404).json({ error: "Not found" }); return; }

  const [imp] = await db.select().from(projectZipImportsTable).where(eq(projectZipImportsTable.projectId, projectId)).limit(1);
  if (!imp) { res.status(404).json({ error: "No zip import" }); return; }

  res.json({
    id: imp.id,
    fileName: imp.fileName,
    fileCount: imp.fileCount,
    fileTree: imp.fileTree,
    importedAt: imp.importedAt,
  });
});

// POST /projects/:id/zip-import — upload + parse a zip file
// Client sends raw zip bytes: Content-Type: application/octet-stream
// Header: X-File-Name: myproject.zip
router.post(
  "/projects/:id/zip-import",
  express.raw({ type: "application/octet-stream", limit: "50mb" }),
  async (req, res): Promise<void> => {
    const userId = (req as any).authUser.id as number;
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (!project || project.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

    const fileName = z.string().min(1).safeParse(req.headers["x-file-name"]);
    if (!fileName.success) { res.status(400).json({ error: "Missing X-File-Name header" }); return; }

    const buffer = req.body as Buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      res.status(400).json({ error: "Empty body — send zip bytes as application/octet-stream" });
      return;
    }

    let parsed: Awaited<ReturnType<typeof parseZipBuffer>>;
    try {
      parsed = await parseZipBuffer(buffer, fileName.data);
    } catch (e: any) {
      res.status(422).json({ error: `Could not parse zip: ${e?.message ?? "unknown error"}` });
      return;
    }

    await db
      .insert(projectZipImportsTable)
      .values({
        projectId,
        fileName: fileName.data,
        fileCount: parsed.entries.length,
        fileTree: parsed.entries,
        fullContext: parsed.fullContext,
      })
      .onConflictDoUpdate({
        target: projectZipImportsTable.projectId,
        set: {
          fileName: fileName.data,
          fileCount: parsed.entries.length,
          fileTree: parsed.entries,
          fullContext: parsed.fullContext,
          importedAt: new Date(),
        },
      });

    res.status(201).json({
      fileName: fileName.data,
      fileCount: parsed.entries.length,
      fileTree: parsed.entries,
      truncated: parsed.truncated,
    });
  }
);

// DELETE /projects/:id/zip-import — clear the stored import
router.delete("/projects/:id/zip-import", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project || project.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(projectZipImportsTable).where(eq(projectZipImportsTable.projectId, projectId));
  res.status(204).end();
});

export default router;
