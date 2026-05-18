import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, projectsTable, readinessSnapshotsTable } from "@workspace/db";
import { decryptToken } from "../lib/tokenCrypto";

const router: IRouter = Router();

type ScanSource = "github" | "zip" | "url";
type ParsedRepo = { owner: string; repo: string; fullName: string };
type TreeFile = { path: string; type?: string };
type LayerKey = "auth" | "database" | "api" | "state" | "ui" | "logic";
type LayerResult = { score: number; signal: string };

const LAYERS: LayerKey[] = ["auth", "database", "api", "state", "ui", "logic"];

function parseOwnerRepoCandidate(value: string): ParsedRepo | null {
  const cleaned = value.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (!cleaned) return null;

  const urlMatch = cleaned.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/i);
  const pathMatch = cleaned.match(/^([^/\s]+)\/([^/\s]+)$/);
  const match = urlMatch ?? pathMatch;
  if (!match) return null;

  const owner = decodeURIComponent(match[1]).trim();
  const repo = decodeURIComponent(match[2]).trim().replace(/\.git$/, "");
  if (!owner || !repo) return null;
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function parseLinkedRepo(raw: string | null): ParsedRepo | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      owner?: unknown;
      repo?: unknown;
      name?: unknown;
      fullName?: unknown;
      full_name?: unknown;
      url?: unknown;
      html_url?: unknown;
    };
    if (typeof parsed.owner === "string" && typeof parsed.repo === "string") {
      return parseOwnerRepoCandidate(`${parsed.owner}/${parsed.repo}`);
    }
    const fullName = typeof parsed.fullName === "string"
      ? parsed.fullName
      : typeof parsed.full_name === "string"
        ? parsed.full_name
        : null;
    if (fullName) return parseOwnerRepoCandidate(fullName);
    const url = typeof parsed.url === "string"
      ? parsed.url
      : typeof parsed.html_url === "string"
        ? parsed.html_url
        : null;
    if (url) return parseOwnerRepoCandidate(url);
    if (typeof parsed.owner === "string" && typeof parsed.name === "string") {
      return parseOwnerRepoCandidate(`${parsed.owner}/${parsed.name}`);
    }
    return null;
  } catch {
    return parseOwnerRepoCandidate(raw);
  }
}

function getProjectGithubToken(storedToken: string | null): string | null {
  const plainToken = storedToken ? decryptToken(storedToken) : null;
  if (plainToken && plainToken !== "__server__") return plainToken;
  return process.env.GITHUB_TOKEN ?? null;
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Atlas-Project-Scan/1.0",
  };
}

function normalizePath(path: string): string {
  return `/${path.toLowerCase()}`;
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1]?.toLowerCase() ?? path.toLowerCase();
}

function addSignal(signals: Map<string, Set<string>>, key: LayerKey, filePath: string, signal: string): void {
  if (!signals.has(key)) signals.set(key, new Set());
  signals.get(key)!.add(`${filePath}\u0000${signal}`);
}

function signalFromMatch(match: string): string {
  return `found ${match}`;
}

function addIfIncludes(signals: Map<string, Set<string>>, key: LayerKey, filePath: string, haystack: string, needles: string[]): void {
  const needle = needles.find((value) => haystack.includes(value));
  if (needle) addSignal(signals, key, filePath, signalFromMatch(needle.replace(/^\/+/, "")));
}

function analyzeFileTree(files: TreeFile[]): Record<LayerKey, LayerResult> {
  const signals = new Map<LayerKey, Set<string>>();
  const tsxFiles = files.filter((file) => file.path.toLowerCase().endsWith(".tsx"));

  for (const file of files) {
    const path = normalizePath(file.path);
    const name = basename(file.path);

    addIfIncludes(signals, "auth", file.path, path, [
      "/auth/",
      "/middleware/auth",
      "passport",
      "jwt",
      "bcrypt",
      "oauth",
      "session",
      "/api/auth",
      "useauth",
    ]);
    if (name === "login.ts" || name === "login.tsx") addSignal(signals, "auth", file.path, signalFromMatch(name));

    addIfIncludes(signals, "database", file.path, path, [
      "/schema/",
      "/db/",
      "/database/",
      "drizzle",
      "prisma",
      "supabase",
      "mongoose",
      "/migrations/",
    ]);
    if (path.endsWith(".sql")) addSignal(signals, "database", file.path, signalFromMatch(".sql files"));
    if (name === "db.ts" || name === "database.ts") addSignal(signals, "database", file.path, signalFromMatch(name));

    addIfIncludes(signals, "api", file.path, path, [
      "/routes/",
      "/api/",
      "/controllers/",
      "express",
      "fastify",
      "hono",
    ]);
    if (name === "server.ts" || name === "app.ts" || name === "index.ts") addSignal(signals, "api", file.path, signalFromMatch(name));

    addIfIncludes(signals, "state", file.path, path, [
      "/store/",
      "redux",
      "zustand",
      "jotai",
      "/context/",
      "usecontext",
      "usestate",
      "recoil",
      "mobx",
    ]);

    addIfIncludes(signals, "ui", file.path, path, [
      "/components/",
      "/pages/",
      "/views/",
      "/src/app/",
      "tailwind",
      "shadcn",
      "styled-components",
    ]);

    addIfIncludes(signals, "logic", file.path, path, [
      "/lib/",
      "/utils/",
      "/helpers/",
      "/services/",
      "/hooks/",
      "/businesslogic/",
    ]);
  }

  if (tsxFiles.length > 5) {
    for (const file of tsxFiles.slice(0, 6)) {
      addSignal(signals, "ui", file.path, signalFromMatch(".tsx files > 5"));
    }
  }

  const result = {} as Record<LayerKey, LayerResult>;
  for (const layer of LAYERS) {
    const layerSignals = [...(signals.get(layer) ?? [])];
    const score = layerSignals.length >= 3 ? 100 : layerSignals.length > 0 ? 60 : 0;
    const signal = layerSignals[0]?.split("\u0000")[1] ?? "not found";
    result[layer] = { score, signal };
  }
  return result;
}

router.post("/projects/:id/scan", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    const source = (req.body as { source?: ScanSource })?.source ?? "github";
    if (source === "zip" || source === "url") {
      res.status(400).json({ error: "zip and url scanning coming soon" });
      return;
    }
    if (source !== "github") {
      res.status(400).json({ error: "Invalid scan source" });
      return;
    }

    const [project] = await db
      .select({ linkedRepo: projectsTable.linkedRepo, githubToken: projectsTable.githubToken })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const repo = parseLinkedRepo(project.linkedRepo ?? null);
    if (!repo) {
      res.status(400).json({ error: "No GitHub repo linked to this project" });
      return;
    }

    const token = getProjectGithubToken(project.githubToken ?? null);
    if (!token) {
      res.status(400).json({ error: "No GitHub token available for this project" });
      return;
    }

    const treeResp = await fetch(
      `https://api.github.com/repos/${repo.fullName}/git/trees/HEAD?recursive=1`,
      { headers: githubHeaders(token), signal: AbortSignal.timeout(10000) },
    );
    if (!treeResp.ok) {
      res.status(502).json({ error: "Failed to fetch GitHub file tree" });
      return;
    }

    const treeData = await treeResp.json() as { tree?: TreeFile[] };
    const files = (treeData.tree ?? []).filter((file) => file.type === "blob" && typeof file.path === "string");
    const layers = analyzeFileTree(files);
    const score = Math.round(LAYERS.reduce((sum, layer) => sum + layers[layer].score, 0) / LAYERS.length);
    const [snapshot] = await db
      .insert(readinessSnapshotsTable)
      .values({ projectId, score })
      .returning();

    res.json({
      score,
      layers,
      repoName: repo.fullName,
      scannedAt: snapshot.recordedAt.toISOString(),
    });
  } catch (err) {
    req.log?.error({ err }, "project scan error");
    res.status(500).json({ error: "Failed to scan project" });
  }
});

export default router;
