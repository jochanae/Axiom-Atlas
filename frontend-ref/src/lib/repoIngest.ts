// ── Repository Ingestion Handler ─────────────────────────────────────────────
// Autonomously derives architecture nodes from a public GitHub repository URL
// and returns them in the exact shape `project.nodeState` expects (matching
// what SystemMap, AxiomFlow, and the Sovereign Readiness Sheet already read).
//
// Designed to slot in behind the existing onboarding flow without changing
// any downstream architecture. The returned `nodes` array can be written
// straight into `project.nodeState` and the `summary` is suitable for a
// Ledger entry body.
// ─────────────────────────────────────────────────────────────────────────────

import type { ArchNode } from "../components/AxiomFlow";

/** Parsed { owner, repo, branch? } from a GitHub URL. */
export interface ParsedRepo {
  owner: string;
  repo: string;
  branch?: string;
}

export interface RepoScanResult {
  /** Nodes ready to merge into `project.nodeState`. Keyed by arch id. */
  nodes: ArchNode[];
  /** Short human summary suitable for a Ledger entry body. */
  summary: string;
  /** What we actually detected — useful for UI feedback. */
  detected: {
    routes: number;
    apiEndpoints: number;
    dbArtifacts: number;
    authProviders: string[];
    framework: string | null;
  };
}

// ── URL parsing ──────────────────────────────────────────────────────────────

const GH_URL_RE =
  /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/\s?#]+))?(?:[/?#].*)?$/i;

export function parseRepoUrl(input: string): ParsedRepo | null {
  if (!input) return null;
  const trimmed = input.trim();
  const m = GH_URL_RE.exec(trimmed);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch: m[3] };
}

// ── GitHub fetch helpers (public REST API, no auth needed) ───────────────────

const GH_API = "https://api.github.com";

interface GhRepoMeta {
  default_branch?: string;
  description?: string;
}

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree" | string;
  size?: number;
}

interface GhTreeResponse {
  tree?: GhTreeEntry[];
  truncated?: boolean;
}

async function ghFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub API ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

async function fetchRawFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── Heuristic classifiers on the tree ────────────────────────────────────────

const ROUTE_DIRS = [
  /^src\/routes\//i,
  /^src\/pages\//i,
  /^app\/(?!api\/)/i,
  /^pages\/(?!api\/)/i,
  /^src\/app\/(?!api\/)/i,
];
const API_DIRS = [
  /^src\/routes\/api\//i,
  /^pages\/api\//i,
  /^app\/api\//i,
  /^src\/app\/api\//i,
  /^api\//i,
  /^supabase\/functions\/[^/]+\/index\.(ts|js)$/i,
  /^server\/(?:routes|api)\//i,
];
const DB_PATTERNS = [
  /^supabase\/migrations\//i,
  /^prisma\/schema\.prisma$/i,
  /^drizzle\.config\.(ts|js|mjs)$/i,
  /^db\/schema/i,
  /\.sql$/i,
  /^migrations\//i,
];
const UI_COMPONENT_DIRS = [/^src\/components\//i, /^components\//i];

function countMatches(paths: string[], patterns: RegExp[]): number {
  return paths.filter((p) => patterns.some((rx) => rx.test(p))).length;
}

function detectAuth(packageJson: string | null): string[] {
  if (!packageJson) return [];
  const providers: string[] = [];
  const text = packageJson.toLowerCase();
  if (text.includes("@supabase/")) providers.push("Supabase Auth");
  if (text.includes("next-auth") || text.includes("@auth/")) providers.push("NextAuth");
  if (text.includes("@clerk/")) providers.push("Clerk");
  if (text.includes("lucia")) providers.push("Lucia");
  if (text.includes("firebase-auth") || text.includes("firebase/auth")) providers.push("Firebase Auth");
  if (text.includes("@auth0/")) providers.push("Auth0");
  return providers;
}

function detectFramework(packageJson: string | null): string | null {
  if (!packageJson) return null;
  const text = packageJson.toLowerCase();
  if (text.includes("@tanstack/react-router") || text.includes("@tanstack/react-start"))
    return "TanStack";
  if (text.includes("\"next\"")) return "Next.js";
  if (text.includes("@remix-run/")) return "Remix";
  if (text.includes("astro")) return "Astro";
  if (text.includes("\"vite\"")) return "Vite + React";
  return null;
}

// ── Node construction ────────────────────────────────────────────────────────

function makeArchNode(
  id: "ui" | "api" | "db" | "auth",
  label: string,
  details: string,
  x: number,
  y: number,
): ArchNode {
  return {
    id,
    label,
    type: "requirement",
    resolved: true,
    x,
    y,
    details,
    strategicAnswer: details,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Autonomously scan a public GitHub repository and derive a node array
 * matching `project.nodeState` expectations. Throws on parse / network /
 * GitHub-rate-limit failure so callers can surface a clean error.
 */
export async function ingestRepository(repoUrl: string): Promise<RepoScanResult> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    throw new Error(
      "That doesn't look like a GitHub repo URL. Expected something like https://github.com/owner/repo",
    );
  }

  // Resolve default branch if not in the URL
  let branch = parsed.branch;
  if (!branch) {
    const meta = await ghFetch<GhRepoMeta>(`/repos/${parsed.owner}/${parsed.repo}`);
    branch = meta.default_branch || "main";
  }

  // Recursive tree
  const tree = await ghFetch<GhTreeResponse>(
    `/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  const paths = (tree.tree ?? [])
    .filter((e) => e.type === "blob" && typeof e.path === "string")
    .map((e) => e.path);

  // Pull package.json for framework/auth detection
  const pkg = paths.includes("package.json")
    ? await fetchRawFile(parsed.owner, parsed.repo, branch, "package.json")
    : null;

  const routes = countMatches(paths, ROUTE_DIRS);
  const apiEndpoints = countMatches(paths, API_DIRS);
  const dbArtifacts = countMatches(paths, DB_PATTERNS);
  const uiComponents = countMatches(paths, UI_COMPONENT_DIRS);
  const authProviders = detectAuth(pkg);
  const framework = detectFramework(pkg);

  // Compose nodes. We deliberately use arch ids `ui`/`api`/`db`/`auth` so the
  // SystemMap + Sovereign Readiness Sheet light up immediately.
  const nodes: ArchNode[] = [];

  // UI — frontend routes + components
  if (routes > 0 || uiComponents > 0) {
    nodes.push(
      makeArchNode(
        "ui",
        framework ? `${framework} frontend` : "Frontend routes",
        `${routes} route file${routes === 1 ? "" : "s"}, ${uiComponents} component${uiComponents === 1 ? "" : "s"} detected${framework ? ` (${framework})` : ""}.`,
        260,
        140,
      ),
    );
  }

  // API — server routes / edge functions
  if (apiEndpoints > 0) {
    nodes.push(
      makeArchNode(
        "api",
        "API surface",
        `${apiEndpoints} backend endpoint${apiEndpoints === 1 ? "" : "s"} detected (routes, edge functions, or API handlers).`,
        480,
        220,
      ),
    );
  }

  // DB — migrations / schema
  if (dbArtifacts > 0) {
    nodes.push(
      makeArchNode(
        "db",
        "Database schema",
        `${dbArtifacts} schema artifact${dbArtifacts === 1 ? "" : "s"} detected (migrations, schema files, or SQL).`,
        420,
        380,
      ),
    );
  }

  // Auth — provider integrations
  if (authProviders.length > 0) {
    nodes.push(
      makeArchNode(
        "auth",
        "Authentication layer",
        `Detected: ${authProviders.join(", ")}.`,
        140,
        300,
      ),
    );
  }

  // Repo-meta context node — always emitted so the Ledger has a referent
  nodes.push({
    id: "repo-source",
    label: `Repository · ${parsed.owner}/${parsed.repo}`,
    type: "decision",
    resolved: true,
    x: 320,
    y: 480,
    details: `Branch: ${branch}. ${paths.length} files indexed.${tree.truncated ? " (tree truncated by GitHub)" : ""}`,
    strategicAnswer: repoUrl.trim(),
  });

  const summaryParts = [
    framework ? `Framework: ${framework}` : null,
    routes > 0 ? `${routes} routes` : null,
    apiEndpoints > 0 ? `${apiEndpoints} API endpoints` : null,
    dbArtifacts > 0 ? `${dbArtifacts} DB artifacts` : null,
    authProviders.length > 0 ? `auth: ${authProviders.join(" + ")}` : null,
  ].filter(Boolean);

  const summary = summaryParts.length > 0
    ? `${parsed.owner}/${parsed.repo} — ${summaryParts.join(" · ")}.`
    : `${parsed.owner}/${parsed.repo} — no recognizable architecture detected.`;

  return {
    nodes,
    summary,
    detected: { routes, apiEndpoints, dbArtifacts, authProviders, framework },
  };
}
