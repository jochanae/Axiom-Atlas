import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const IGNORE_RE = /node_modules|\.next|\.nuxt|dist\/|build\/|\.lock$|\.log$|\.map$|\.min\.|\.pnp\.|\.cache|__pycache__|\.pyc$|\.class$|\.jar$|\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$|\.ico$|\.svg$|\.woff|\.ttf|\.eot$|\.mp4$|\.mp3$|\.zip$|\.gz$|\.tar$|\.tgz$/i;

const TEXT_EXT_RE = /\.(ts|tsx|js|jsx|json|css|scss|sass|less|html|htm|md|mdx|txt|env\.example|gitignore|yaml|yml|toml|prisma|sql|sh|py|rb|go|rs|java|kt|swift|vue|svelte|astro|graphql|gql|xml|csv)$/i;

const MAX_FILES = 80;
const MAX_LINE_LENGTH = 2000;
const MAX_FILE_LINES = 500;
const MAX_TOTAL_CHARS = 400_000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post(
  "/upload/code-context",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded. Send a zip as multipart field named 'file'." });
      return;
    }

    if (!file.originalname.toLowerCase().endsWith(".zip") && file.mimetype !== "application/zip") {
      res.status(400).json({ error: "Only .zip files are supported." });
      return;
    }

    try {
      const zip = new AdmZip(file.buffer);
      const entries = zip.getEntries();

      const files: Array<{ path: string; content: string; lines: number; truncated: boolean }> = [];
      let totalChars = 0;
      let skipped = 0;

      for (const entry of entries) {
        if (files.length >= MAX_FILES) { skipped++; continue; }
        if (entry.isDirectory) continue;

        const entryPath = entry.entryName
          .replace(/^[^/]+\//, "")
          .replace(/\\/g, "/");

        if (!entryPath) continue;
        if (IGNORE_RE.test(entryPath)) continue;
        if (!TEXT_EXT_RE.test(entryPath)) continue;

        if (entry.header.size > 200_000) continue;

        let text: string;
        try {
          text = entry.getData().toString("utf-8");
        } catch {
          continue;
        }

        if (!text.trim()) continue;

        const rawLines = text.split("\n");
        const truncated = rawLines.length > MAX_FILE_LINES;
        const lines = rawLines
          .slice(0, MAX_FILE_LINES)
          .map(l => l.length > MAX_LINE_LENGTH ? l.slice(0, MAX_LINE_LENGTH) + "…" : l);

        const content = lines.join("\n");
        if (totalChars + content.length > MAX_TOTAL_CHARS) { skipped++; continue; }

        totalChars += content.length;
        files.push({ path: entryPath, content, lines: rawLines.length, truncated });
      }

      if (files.length === 0) {
        res.status(422).json({
          error: "No readable source files found in zip. Make sure it contains .ts, .tsx, .js, .jsx, .css, .json, etc. and isn't just node_modules or build output.",
        });
        return;
      }

      const fileContext = files
        .map(f => `=== ${f.path}${f.truncated ? ` [first ${MAX_FILE_LINES} of ${f.lines} lines]` : ""} ===\n${f.content}`)
        .join("\n\n");

      const summary = `Uploaded zip: ${files.length} files extracted (${(totalChars / 1000).toFixed(0)}k chars)${skipped > 0 ? `, ${skipped} files skipped (size/type limits)` : ""}.`;

      res.json({
        fileContext,
        summary,
        fileCount: files.length,
        totalChars,
        skipped,
        filePaths: files.map(f => f.path),
      });
    } catch (err) {
      logger.error({ err }, "zip parse error");
      res.status(422).json({ error: "Could not read zip file. Make sure it's a valid .zip archive." });
    }
  }
);

export default router;
