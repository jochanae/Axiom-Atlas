import { Router, type IRouter } from "express";
import { readdir, readFile, stat } from "fs/promises";
import * as nodePath from "path";
import { atlasSelfMapTable, db } from "@workspace/db";
import { desc } from "drizzle-orm";

type IndexedFile = {
  path: string;
  size: number;
  exports: string[];
  internalImports: string[];
};

type SelfMap = {
  generatedAt: string;
  roots: string[];
  files: IndexedFile[];
  relationships: Array<{ from: string; to: string }>;
};

const router: IRouter = Router();
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css"]);
const IMPORT_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".json", ".css", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function workspaceRoot() {
  return process.env.WORKSPACE_ROOT ?? process.cwd();
}

function toRelativePath(root: string, filePath: string) {
  return nodePath.relative(root, filePath).split(nodePath.sep).join("/");
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath);
    if (!entry.isFile()) return [];
    return [fullPath];
  }));
  return files.flat();
}

function extractExports(content: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)?/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      names.add(match[1] ?? "default");
    }
  }

  for (const match of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    const exported = match[1] ?? "";
    for (const part of exported.split(",")) {
      const name = part.trim().split(/\s+as\s+/i).pop()?.trim();
      if (name) names.add(name);
    }
  }

  return [...names].sort();
}

function extractImportSpecifiers(content: string): string[] {
  const specs = new Set<string>();
  for (const match of content.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g)) {
    if (match[1]) specs.add(match[1]);
  }
  return [...specs];
}

function resolveImport(fromFile: string, specifier: string, root: string, knownFiles: Set<string>): string | null {
  let targetBase: string | null = null;
  if (specifier.startsWith(".")) {
    targetBase = nodePath.resolve(nodePath.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    targetBase = nodePath.resolve(root, "artifacts/atlas/src", specifier.slice(2));
  }

  if (!targetBase) return null;

  for (const suffix of IMPORT_EXTENSIONS) {
    const candidate = toRelativePath(root, `${targetBase}${suffix}`);
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}

export async function buildSelfMap(): Promise<{ file_count: number; created_at: Date }> {
  const root = workspaceRoot();
  const sourceRoots = [
    nodePath.join(root, "artifacts/atlas/src"),
    nodePath.join(root, "artifacts/api-server/src"),
  ];
  const absoluteFiles = (await Promise.all(sourceRoots.map((sourceRoot) => collectFiles(sourceRoot)))).flat().sort();
  const knownFiles = new Set(absoluteFiles.map((filePath) => toRelativePath(root, filePath)));
  const files: IndexedFile[] = [];

  for (const filePath of absoluteFiles) {
    const fileStat = await stat(filePath);
    const content = TEXT_EXTENSIONS.has(nodePath.extname(filePath))
      ? await readFile(filePath, "utf-8")
      : "";
    const relativePath = toRelativePath(root, filePath);
    const internalImports = extractImportSpecifiers(content)
      .map((specifier) => resolveImport(filePath, specifier, root, knownFiles))
      .filter((target): target is string => target !== null);

    files.push({
      path: relativePath,
      size: fileStat.size,
      exports: extractExports(content),
      internalImports,
    });
  }

  const selfMap: SelfMap = {
    generatedAt: new Date().toISOString(),
    roots: sourceRoots.map((sourceRoot) => toRelativePath(root, sourceRoot)),
    files,
    relationships: files.flatMap((file) => file.internalImports.map((target) => ({ from: file.path, to: target }))),
  };

  await db.delete(atlasSelfMapTable);
  const [row] = await db
    .insert(atlasSelfMapTable)
    .values({ mapJson: JSON.stringify(selfMap), fileCount: files.length })
    .returning({ fileCount: atlasSelfMapTable.fileCount, createdAt: atlasSelfMapTable.createdAt });

  if (!row) throw new Error("Failed to store self map");
  return { file_count: row.fileCount, created_at: row.createdAt };
}

router.post("/selfmap/refresh", async (_req, res): Promise<void> => {
  const result = await buildSelfMap();
  res.json({ file_count: result.file_count, created_at: result.created_at.toISOString() });
});

router.get("/selfmap/dependencies", async (req, res): Promise<void> => {
  const filePath = req.query.file as string | undefined;
  
  // Load the stored selfmap
  const rows = await db.select().from(atlasSelfMapTable)
    .orderBy(desc(atlasSelfMapTable.createdAt)).limit(1);
  
  if (!rows[0]) {
    res.status(404).json({ error: "No selfmap found. Run /api/selfmap/refresh first." });
    return;
  }
  
  const selfMap = JSON.parse(rows[0].mapJson) as {
    files: Array<{ path: string; exports: string[]; internalImports: string[] }>;
    relationships: Array<{ from: string; to: string }>;
  };
  
  if (!filePath) {
    // Return full dependency summary — most connected files
    const connectionCount = new Map<string, number>();
    for (const rel of selfMap.relationships) {
      connectionCount.set(rel.from, (connectionCount.get(rel.from) ?? 0) + 1);
      connectionCount.set(rel.to, (connectionCount.get(rel.to) ?? 0) + 1);
    }
    const hotspots = [...connectionCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([path, count]) => ({ path, connections: count }));
    res.json({ hotspots, totalFiles: selfMap.files.length, totalRelationships: selfMap.relationships.length });
    return;
  }
  
  // Return dependencies for a specific file
  const dependencies = selfMap.relationships
    .filter(r => r.from === filePath)
    .map(r => r.to);
  
  const dependents = selfMap.relationships
    .filter(r => r.to === filePath)
    .map(r => r.from);
  
  const fileInfo = selfMap.files.find(f => f.path === filePath);
  
  res.json({
    file: filePath,
    exports: fileInfo?.exports ?? [],
    dependencies,
    dependents,
    impactRadius: dependents.length,
  });
});

export default router;
