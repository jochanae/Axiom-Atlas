import { Router } from "express";
import { db, sessionsTable, chatMessagesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { promises as fsp, existsSync } from "fs";
import path from "path";
import { projectWorkspaceDir } from "../lib/projectWorkspace";

const router = Router();

// Extract FILE_EDIT blocks from a message
function parseFileEdits(content: string): Array<{ path: string; language: string; content: string }> {
  const files: Array<{ path: string; language: string; content: string }> = [];
  const regex = /FILE_EDIT_START\npath: ([^\n]+)\nlanguage: ([^\n]+)\nFILE_EDIT_CONTENT\n([\s\S]*?)\nFILE_EDIT_END/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    files.push({
      path: match[1].trim(),
      language: match[2].trim(),
      content: match[3].trim(),
    });
  }
  return files;
}

// Determine language from file extension
function langFromExt(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    css: 'css', html: 'html', json: 'json', md: 'markdown',
  };
  return map[ext] ?? 'text';
}

// Recursively collect all files from a workspace directory
async function readWorkspaceFiles(
  dir: string,
  base: string = dir,
  skipBinary = true
): Promise<Array<{ path: string; language: string; content: string }>> {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache']);
  const BINARY_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'woff', 'woff2', 'ttf', 'eot', 'zip', 'tar', 'gz']);
  const results: Array<{ path: string; language: string; content: string }> = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...await readWorkspaceFiles(fullPath, base, skipBinary));
    } else if (entry.isFile()) {
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
      if (skipBinary && BINARY_EXTS.has(ext)) continue;
      try {
        const content = await fsp.readFile(fullPath, 'utf-8');
        const relPath = path.relative(base, fullPath);
        results.push({ path: relPath, language: langFromExt(entry.name), content });
      } catch {
        // skip unreadable files
      }
    }
  }
  return results;
}

// Build a standalone HTML page that renders a React component
function buildComponentPreview(componentCode: string, componentName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview - ${componentName}</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0C0A09;
      color: #E7E5E4;
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    #root { width: 100%; max-width: 100%; }
    .preview-container {
      background: #1C1917;
      border: 1px solid #252220;
      border-radius: 12px;
      overflow: hidden;
      width: 100%;
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      margin: 16px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    // Error boundary
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      render() {
        if (this.state.hasError) {
          return React.createElement('div', { className: 'error-banner' },
            'Preview error: ' + this.state.error?.message || 'Unknown error'
          );
        }
        return this.props.children;
      }
    }

    // Stub common components Atlas might reference
    const Stub = ({ name }) => React.createElement('div', {
      style: {
        padding: '8px 12px',
        border: '1px dashed rgba(201,162,76,0.3)',
        borderRadius: 6,
        color: 'rgba(201,162,76,0.6)',
        fontSize: 11,
        fontFamily: 'monospace',
      }
    }, name);

    // Component from Atlas
    ${componentCode}

    // Render
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(
      React.createElement(ErrorBoundary, null,
        React.createElement('div', { className: 'preview-container' },
          typeof ${componentName} !== 'undefined'
            ? React.createElement(${componentName})
            : React.createElement(Stub, { name: 'Component not found: ${componentName}' })
        )
      )
    );
  </script>
</body>
</html>`;
}

// Strip ES module import/export statements so Babel-standalone can run the code inline.
// All modules are concatenated into a single script, so imports are resolved by load order.
function stripModuleStatements(code: string): string {
  return code
    // Remove: import ... from '...'  /  import '...'
    .replace(/^import\s+.*?from\s+['"][^'"]*['"]\s*;?\s*$/gm, '')
    .replace(/^import\s+['"][^'"]*['"]\s*;?\s*$/gm, '')
    // export default function/class Name → function/class Name (keeps name accessible in outer scope)
    .replace(/^export\s+default\s+(function|class)\s+(\w+)/gm, '$1 $2')
    // export default <expr>; → var __defaultExport = <expr>;
    .replace(/^export\s+default\s+/gm, 'var __defaultExport = ')
    // export { ... }  → remove
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    // export const/let/var/function/class Name → const/let/var/function/class Name
    .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ');
}

// Build a preview HTML page from multiple workspace files.
// Concatenates all JS/JSX/TS/TSX files (with imports stripped) and inlines CSS.
// Entry point priority: App.jsx > App.tsx > index.jsx > index.tsx > first JS file.
function buildMultiFilePreview(files: Array<{ path: string; content: string }>): string {
  const jsExts = new Set(['.jsx', '.tsx', '.js', '.ts']);
  const cssExts = new Set(['.css']);

  const isJs = (p: string) => jsExts.has('.' + (p.split('.').pop() ?? ''));
  const isCss = (p: string) => cssExts.has('.' + (p.split('.').pop() ?? ''));

  // Collect CSS (inline as <style>)
  const cssContent = files
    .filter(f => isCss(f.path))
    .map(f => f.content)
    .join('\n');

  // Collect JS files, ordered: support files first, then main entry
  const jsFiles = files.filter(f => isJs(f.path));

  const ENTRY_PRIORITY = ['App.jsx', 'App.tsx', 'app.jsx', 'app.tsx', 'index.jsx', 'index.tsx'];
  const basename = (p: string) => p.split('/').pop() ?? p;

  const mainFile = ENTRY_PRIORITY
    .map(name => jsFiles.find(f => basename(f.path) === name))
    .find(Boolean) ?? jsFiles[0];

  const componentName = mainFile
    ? basename(mainFile.path).replace(/\.[jt]sx?$/, '')
    : 'App';

  // All support files first (context, screens, components) then the main entry
  const supportFiles = jsFiles.filter(f => f !== mainFile);
  // Sort: context before components before screens before root
  const sortOrder = (p: string) =>
    p.includes('context') ? 0 : p.includes('components') ? 1 : p.includes('screens') ? 2 : 3;
  supportFiles.sort((a, b) => sortOrder(a.path) - sortOrder(b.path));

  const allJsCode = [...supportFiles, ...(mainFile ? [mainFile] : [])]
    .map(f => `\n// ---- ${f.path} ----\n${stripModuleStatements(f.content)}`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0C0A09;
      color: #E7E5E4;
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
    }
    #root { width: 100%; min-height: 100vh; }
    .error-banner {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      margin: 16px;
      white-space: pre-wrap;
    }
    ${cssContent.replace(/`/g, '\\`')}
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    /* globals React, ReactDOM */
    const { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } = React;

    // Stub react-router-dom — all names exposed as standalone vars so stripped imports don't leave undefineds
    var BrowserRouter = ({ children }) => children;
    var HashRouter = ({ children }) => children;
    var MemoryRouter = ({ children }) => children;
    var Routes = ({ children }) => children;
    var Route = ({ element }) => element ?? null;
    var Navigate = ({ to }) => null;
    var Outlet = () => null;
    var Link = ({ children, to, className, style, onClick }) =>
      React.createElement('a', { href: to ?? '#', className, style, onClick }, children);
    // NavLink supports both element children and render-prop children ({ isActive }) => ...
    var NavLink = ({ children, to, className, style, onClick }) => {
      const isActive = typeof window !== 'undefined' && window.location.pathname === to;
      const resolvedChildren = typeof children === 'function' ? children({ isActive }) : children;
      const resolvedClass = typeof className === 'function' ? className({ isActive }) : className;
      return React.createElement('a', { href: to ?? '#', className: resolvedClass, style, onClick }, resolvedChildren);
    };
    var useNavigate = () => () => {};
    var useLocation = () => ({ pathname: '/', search: '', hash: '' });
    var useParams = () => ({});

    class ErrorBoundary extends React.Component {
      constructor(props) { super(props); this.state = { hasError: false, error: null }; }
      static getDerivedStateFromError(error) { return { hasError: true, error }; }
      render() {
        if (this.state.hasError) {
          return React.createElement('div', { className: 'error-banner' },
            'Preview render error: ' + (this.state.error?.message ?? 'Unknown error'));
        }
        return this.props.children;
      }
    }

    ${allJsCode}

    const RootComponent = typeof ${componentName} !== 'undefined'
      ? ${componentName}
      : (typeof __defaultExport !== 'undefined' ? __defaultExport : null);

    const rootEl = document.getElementById('root');
    if (!rootEl) { throw new Error('#root element not found'); }
    const root = ReactDOM.createRoot(rootEl);
    root.render(
      React.createElement(ErrorBoundary, null,
        RootComponent
          ? React.createElement(MemoryRouter, null, React.createElement(RootComponent))
          : React.createElement('div', { style: { padding: 16, color: '#ef4444', fontFamily: 'monospace' } }, 'Component "${componentName}" not found in generated code')
      )
    );
  </script>
</body>
</html>`;
}

// GET /api/preview/session/:sessionId - renders the latest FILE_EDIT as a preview page
router.get("/preview/session/:sessionId", async (req, res): Promise<void> => {
  const sessionId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  try {
    // Get the latest assistant message
    const messages = await db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.sessionId, sessionId))
      .orderBy(desc(chatMessagesTable.createdAt))
      .limit(10);

    const assistantMsg = messages.find(m => m.role === "assistant");
    if (!assistantMsg) {
      res.status(404).json({ error: "No assistant message found" });
      return;
    }

    let files = parseFileEdits(assistantMsg.content);

    // Fallback: FILE_EDIT blocks are stripped before DB persistence during auto-apply.
    // Read the generated files directly from the project workspace directory instead.
    if (files.length === 0) {
      const [session] = await db
        .select({ projectId: sessionsTable.projectId })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .limit(1);
      if (session) {
        const wsDir = projectWorkspaceDir(session.projectId);
        files = await readWorkspaceFiles(wsDir);
      }
    }

    if (files.length === 0) {
      res.status(404).json({ error: "No generated files found for this session" });
      return;
    }

    const html = buildMultiFilePreview(files);
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    res.send(html);
  } catch (err) {
    console.error("Preview error:", err);
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

// GET /api/preview/component - POST a component and get a preview
router.post("/preview/component", async (req, res): Promise<void> => {
  const { code, componentName = "Component" } = req.body as { code: string; componentName?: string };

  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code is required" });
    return;
  }

  try {
    const html = buildComponentPreview(code, componentName);
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    res.send(html);
  } catch (err) {
    console.error("Preview error:", err);
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

// GET /api/preview/workspace/:projectId/* — serve built dist/ output as a static SPA.
// Called by the PreviewPanel Local Dev iframe once "Run Project" succeeds.
router.use("/preview/workspace/:projectId", (req, res): void => {
  const projectId = Number(req.params["projectId"]);
  if (!projectId) { res.status(400).send("Invalid projectId"); return; }
  const wsDir = projectWorkspaceDir(projectId);
  const distDir = path.join(wsDir, "dist");
  if (!existsSync(distDir)) {
    res.status(404).send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:monospace;background:#0a0a0f;color:#8B8577;display:flex;align-items:center;
             justify-content:center;min-height:100vh;margin:0;font-size:13px;text-align:center;}
      </style></head><body>
        <div><div style="color:#C9A24C;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:12px">
          No Build Output</div>
          Build output not found — click "Run Project" to install dependencies and build.
        </div>
      </body></html>`);
    return;
  }
  // Strip the router prefix so the remaining path is relative to dist/
  const rawPath = req.path === "/" ? "/index.html" : req.path;
  // Guard against path traversal
  const resolved = path.resolve(distDir, rawPath.replace(/^\//, ""));
  if (!resolved.startsWith(distDir + path.sep) && resolved !== distDir) {
    res.status(403).send("Forbidden"); return;
  }
  if (existsSync(resolved) && !resolved.endsWith("/")) {
    res.sendFile(resolved);
  } else {
    // SPA fallback — serve index.html for all unmatched paths
    const indexPath = path.join(distDir, "index.html");
    if (existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).send("index.html not found in build output");
  }
});

export default router;
