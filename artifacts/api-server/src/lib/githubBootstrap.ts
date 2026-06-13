import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, connectionsTable, projectsTable } from "@workspace/db";
import { decryptToken } from "./tokenCrypto";

const GH_API = "https://api.github.com";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Axiom-Atlas/1.0",
    "Content-Type": "application/json",
  };
}

export async function getGithubTokenForUser(userId: number): Promise<string | null> {
  const [conn] = await db
    .select({ token: connectionsTable.token })
    .from(connectionsTable)
    .where(and(
      eq(connectionsTable.userId, userId),
      eq(connectionsTable.type, "github"),
      isNotNull(connectionsTable.token),
    ))
    .orderBy(desc(connectionsTable.createdAt))
    .limit(1);

  if (conn?.token) {
    const plain = decryptToken(conn.token);
    if (plain && plain !== "__server__") return plain;
  }

  const [proj] = await db
    .select({ githubToken: projectsTable.githubToken })
    .from(projectsTable)
    .where(and(eq(projectsTable.userId, userId), isNotNull(projectsTable.githubToken)))
    .orderBy(desc(projectsTable.createdAt))
    .limit(1);

  if (proj?.githubToken) {
    const plain = decryptToken(proj.githubToken);
    if (plain && plain !== "__server__") return plain;
  }

  return null;
}

export function sanitizeRepoName(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return clean || "new-project";
}

type ScaffoldFile = { path: string; content: string };

export function getScaffoldFiles(appName: string): ScaffoldFile[] {
  const title = appName
    .split(/[-_\s]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return [
    {
      path: ".gitignore",
      content: `node_modules\ndist\n.env\n.env.local\n.DS_Store\n`,
    },
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: "package.json",
      content: JSON.stringify({
        name: sanitizeRepoName(appName),
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "tsc && vite build",
          preview: "vite preview",
        },
        dependencies: {
          react: "^18.3.1",
          "react-dom": "^18.3.1",
        },
        devDependencies: {
          "@types/react": "^18.3.1",
          "@types/react-dom": "^18.3.1",
          "@vitejs/plugin-react": "^4.3.2",
          autoprefixer: "^10.4.20",
          postcss: "^8.4.47",
          tailwindcss: "^3.4.14",
          typescript: "^5.5.3",
          vite: "^5.4.8",
        },
      }, null, 2),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          useDefineForClassFields: true,
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          module: "ESNext",
          skipLibCheck: true,
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          isolatedModules: true,
          noEmit: true,
          jsx: "react-jsx",
          strict: true,
        },
        include: ["src"],
      }, null, 2),
    },
    {
      path: "vite.config.ts",
      content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
    },
    {
      path: "tailwind.config.js",
      content: `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
`,
    },
    {
      path: "postcss.config.js",
      content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`,
    },
    {
      path: "src/index.css",
      content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`,
    },
    {
      path: "src/main.tsx",
      content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
    },
    {
      path: "src/App.tsx",
      content: `export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-lg">
        <h1 className="text-4xl font-bold tracking-tight">${title}</h1>
        <p className="text-gray-400 text-lg">
          Your project is ready. Start building with Atlas.
        </p>
      </div>
    </div>
  )
}
`,
    },
  ];
}

export type BootstrapResult =
  | { ok: true; linkedRepo: string; htmlUrl: string; repoName: string; previewUrl: string }
  | { ok: false; error: string; noToken?: boolean };

export async function bootstrapGitHubRepo(opts: {
  token: string;
  projectId: number;
  projectName: string;
}): Promise<BootstrapResult> {
  const { token, projectId, projectName } = opts;

  // 1. Get authenticated GitHub user login
  const meResp = await fetch(`${GH_API}/user`, { headers: ghHeaders(token) });
  if (!meResp.ok) {
    return { ok: false, error: `GitHub auth failed (${meResp.status})` };
  }
  const me = await meResp.json() as { login: string };
  const repoName = sanitizeRepoName(projectName);

  // 2. Create the repository
  const createResp = await fetch(`${GH_API}/user/repos`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      name: repoName,
      description: `Built with Axiom Atlas`,
      private: true,
      auto_init: false,
    }),
  });

  if (!createResp.ok) {
    const errBody = await createResp.json() as { message?: string; errors?: Array<{ message?: string }> };
    const msg = errBody.errors?.[0]?.message ?? errBody.message ?? "Unknown error";
    return { ok: false, error: `Failed to create repo: ${msg}` };
  }

  const repoData = await createResp.json() as { full_name: string; html_url: string };
  const fullName = repoData.full_name;

  // 3. Create blobs for each scaffold file
  const files = getScaffoldFiles(repoName);
  const blobResults = await Promise.all(
    files.map(async (f) => {
      const r = await fetch(`${GH_API}/repos/${fullName}/git/blobs`, {
        method: "POST",
        headers: ghHeaders(token),
        body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
      });
      if (!r.ok) throw new Error(`Blob creation failed for ${f.path}`);
      const b = await r.json() as { sha: string };
      return { path: f.path, sha: b.sha, mode: "100644" as const, type: "blob" as const };
    }),
  );

  // 4. Create tree
  const treeResp = await fetch(`${GH_API}/repos/${fullName}/git/trees`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ tree: blobResults }),
  });
  if (!treeResp.ok) return { ok: false, error: "Failed to create git tree" };
  const treeData = await treeResp.json() as { sha: string };

  // 5. Create initial commit
  const commitResp = await fetch(`${GH_API}/repos/${fullName}/git/commits`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      message: "Initial scaffold — created with Axiom Atlas",
      tree: treeData.sha,
      parents: [],
    }),
  });
  if (!commitResp.ok) return { ok: false, error: "Failed to create initial commit" };
  const commitData = await commitResp.json() as { sha: string };

  // 6. Create main branch ref
  const refResp = await fetch(`${GH_API}/repos/${fullName}/git/refs`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: "refs/heads/main", sha: commitData.sha }),
  });
  if (!refResp.ok) return { ok: false, error: "Failed to set main branch" };

  // 7. Set default branch to main
  await fetch(`${GH_API}/repos/${fullName}`, {
    method: "PATCH",
    headers: ghHeaders(token),
    body: JSON.stringify({ default_branch: "main" }),
  });

  // 8. Link the repo + set StackBlitz preview URL on the project
  const stackblitzUrl = `https://stackblitz.com/github/${fullName}`;
  await db
    .update(projectsTable)
    .set({ linkedRepo: fullName, previewUrl: stackblitzUrl })
    .where(eq(projectsTable.id, projectId));

  return { ok: true, linkedRepo: fullName, htmlUrl: repoData.html_url, repoName, previewUrl: stackblitzUrl };
}
