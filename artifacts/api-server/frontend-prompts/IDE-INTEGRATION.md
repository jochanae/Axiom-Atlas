# Cursor Prompt: Atlas IDE Integration

## Task
Build an integrated IDE workspace panel inside the existing `workspace.tsx` page. No new routes. No `/code` page. The IDE lives as a collapsible panel within the workspace chat, toggled by the user. Atlas drives the workspace — the dialogue creates the workspace, not the other way around.

## Backend Already Provides

```typescript
// GET /api/projects/:projectId/runs — sessions with generation activity
interface Run {
  id: number;
  projectId: number;
  title: string;
  mode: string;
  status: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
  totalExecutionMs: number;
  runStatus: string | null;        // "completed" | "in_progress" | "failed"
  runSummary: string | null;       // e.g. "Updated 3 files: src/App.tsx, src/lib/db.ts..."
  runActions: Array<{ verb: string; target: string; detail: string; status: "ok" | "warn" | "error" }> | null;
  runArtifacts: Array<{ type: "file"; label: string; meta: string }> | null;
  createdAt: string;
  updatedAt: string;
}

// GET /api/projects/:projectId/generation-runs — dedicated generation tracking (new table)
interface GenerationRun {
  id: string;
  projectId: number;
  userId: number;
  prompt: string;
  intent: string;
  model: string;
  status: string;        // "completed" | "failed" | "in_progress"
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  summary: string;
  commitSha: string | null;
  pushedToBranch: string | null;
}

// GET /api/projects/:projectId/generation-runs/:runId/files
interface GeneratedFile {
  id: string;
  runId: string;
  path: string;
  language: string;
  bytes: number;
  lines: number;
  content: string;
  previousContent: string | null;
  status: string;       // "created" | "modified" | "deleted"
  createdAt: string;
  updatedAt: string;
}

// Existing session APIs already in workspace.tsx
// useListSessions, useListMessages, useCreateSession — all already imported
```

## What to Build

### 1. IDE Panel — `components/IDEPanel.tsx`

A slide-in panel from the right (or bottom on mobile) that sits alongside the chat. The workspace is already two-pane (chat left + Decision Ledger right). The IDE panel is a **third tab** in the right pane — or a toggle that replaces the ledger.

**Placement:** Inside `workspace.tsx`, the right pane currently has tabs: "Ledger" | "StackBlitz" | "Files" (or similar). Add: **"Workspace"** (the IDE).

**Panel structure:**
```
┌─────────────────────────────────────────────────────┐
│  [Header] "Workspace" │ [×] close                │
├─────────────────────────────────────────────────────┤
│  [Run list]                                         │
│  ├─ "Build auth flow" — 3 files · 2 min ago      │
│  ├─ "Fix landing CSS" — 1 file  · 5 min ago      │
│  └─ "Add Stripe checkout" — 5 files · 1h ago     │
├─────────────────────────────────────────────────────┤
│  [File tree for selected run]                       │
│  ├─ src/pages/login.tsx                             │
│  ├─ src/components/AuthForm.tsx                     │
│  └─ src/lib/auth.ts                                  │
├─────────────────────────────────────────────────────┤
│  [CodeMirror editor]                                 │
│  ┌─────────────────────────────────────────────────┐│
│  │  import { useState } from "react";              ││
│  │  // ...                                         ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│  [Actions] [Accept] [Reject] [Push to GitHub]       │
└─────────────────────────────────────────────────────┘
```

### 2. Run List — `components/IDERunList.tsx`

Shows generation runs. Styled with Atlas tokens:
- `--atlas-bg: #0C0A09`
- `--atlas-surface: #1C1917`
- `--atlas-fg: #E7E5E4`
- `--atlas-muted: #78716C`
- `--atlas-gold: #C9A24C`
- `--atlas-border: #252220`

Each run card:
```tsx
<div style={{
  padding: "10px 12px",
  borderRadius: 8,
  background: "var(--atlas-surface)",
  border: "1px solid var(--atlas-border)",
  cursor: "pointer",
}}>
  <div style={{ fontSize: 13, color: "var(--atlas-fg)", fontWeight: 500 }}>
    {run.runSummary || run.title}
  </div>
  <div style={{ fontSize: 11, color: "var(--atlas-muted)", marginTop: 4 }}>
    {run.runArtifacts?.length ?? 0} files · {formatTimeAgo(run.updatedAt)}
  </div>
  {/* Status badge */}
  <span style={{
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    padding: "2px 6px",
    borderRadius: 4,
    background: run.runStatus === "completed" ? "rgba(134,239,172,0.12)" : "rgba(250,204,21,0.12)",
    color: run.runStatus === "completed" ? "rgba(134,239,172,0.9)" : "rgba(250,204,21,0.9)",
  }}>
    {run.runStatus}
  </span>
</div>
```

### 3. File Tree — `components/IDEFileTree.tsx`

Simple recursive tree. Click to select file. Show:
- File name
- Language (from `meta` field)
- Status dot: green=created, amber=modified, red=deleted

```tsx
interface FileNode {
  type: "file" | "dir";
  name: string;
  path: string;
  language?: string;
  status?: "created" | "modified" | "deleted";
  children?: FileNode[];
}

function buildTree(files: Array<{ path: string; language: string; status: string }>): FileNode {
  const root: FileNode = { type: "dir", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      if (isFile) {
        current.children!.push({
          type: "file", name: part, path,
          language: file.language,
          status: file.status as "created" | "modified" | "deleted",
        });
      } else {
        let dir = current.children!.find(c => c.type === "dir" && c.name === part);
        if (!dir) {
          dir = { type: "dir", name: part, path, children: [] };
          current.children!.push(dir);
        }
        current = dir;
      }
    }
  }
  return root;
}
```

### 4. CodeMirror Editor — `components/IDEEditor.tsx`

Use `@uiw/react-codemirror` with these extensions:
```typescript
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { loadLanguage } from "@uiw/codemirror-extensions-langs";

// Language mapping
const LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  css: "css", scss: "css", html: "html", json: "json",
  py: "python", sql: "sql", md: "markdown", yaml: "yaml",
  yml: "yaml", sh: "shell", bash: "shell", zsh: "shell",
  go: "go", rs: "rust", java: "java", c: "c", cpp: "cpp",
  php: "php", rb: "ruby", swift: "swift", kt: "kotlin",
};

function getLanguageExtension(language: string) {
  const lang = LANG_MAP[language] || language;
  return loadLanguage(lang) || [];
}

// In the component:
<CodeMirror
  value={fileContent}
  height="100%"
  theme={theme === "dark" ? oneDark : "light"}
  extensions={[getLanguageExtension(fileLanguage)]}
  onChange={(value) => onFileChange(value)}
  basicSetup={{
    lineNumbers: true,
    highlightActiveLineGutter: true,
    highlightActiveLine: true,
    foldGutter: true,
    autocompletion: false, // Atlas provides completions, not the editor
  }}
  style={{
    fontSize: 13,
    fontFamily: "var(--app-font-mono), ui-monospace, SFMono-Regular, monospace",
    background: "var(--atlas-bg)",
  }}
/>
```

Theme override for Atlas dark:
```typescript
import { EditorView } from "@codemirror/view";

const atlasDarkTheme = EditorView.theme({
  "&": { backgroundColor: "#0C0A09 !important" },
  ".cm-content": { color: "#E7E5E4", caretColor: "#C9A24C" },
  ".cm-gutters": { backgroundColor: "#1C1917", borderRight: "1px solid #252220", color: "#78716C" },
  ".cm-activeLineGutter": { backgroundColor: "#1C1917", color: "#C9A24C" },
  ".cm-activeLine": { backgroundColor: "rgba(201,162,76,0.06)" },
  ".cm-selectionBackground": { backgroundColor: "rgba(201,162,76,0.2)" },
  ".cm-matchingBracket": { backgroundColor: "rgba(201,162,76,0.15)" },
  ".cm-cursor": { borderLeftColor: "#C9A24C" },
}, { dark: true });
```

### 5. Diff View — `components/IDEDiffView.tsx`

When a file has `previousContent`, show a split diff:
```tsx
import { diffLines } from "diff";

function renderDiff(oldContent: string, newContent: string) {
  const diff = diffLines(oldContent, newContent);
  return diff.map((part, i) => {
    const isAdded = part.added;
    const isRemoved = part.removed;
    return (
      <div key={i} style={{
        background: isAdded ? "rgba(134,239,172,0.08)" : isRemoved ? "rgba(248,113,113,0.08)" : "transparent",
        borderLeft: isAdded ? "2px solid rgba(134,239,172,0.5)" : isRemoved ? "2px solid rgba(248,113,113,0.5)" : "2px solid transparent",
        padding: "0 8px",
        whiteSpace: "pre-wrap",
        fontFamily: "var(--app-font-mono)",
        fontSize: 12,
        lineHeight: 1.6,
        color: isAdded ? "rgba(134,239,172,0.9)" : isRemoved ? "rgba(248,113,113,0.9)" : "var(--atlas-fg)",
      }}>
        {part.value}
      </div>
    );
  });
}
```

### 6. Integration into workspace.tsx

Find the right pane tab section (around line 6900). Add "Workspace" as a tab alongside existing ones.

```tsx
// In workspace.tsx, near the right pane tabs:
const [rightPaneTab, setRightPaneTab] = useState<"ledger" | "stackblitz" | "workspace">("ledger");

// In the tab bar:
<button
  onClick={() => setRightPaneTab("workspace")}
  style={{
    padding: "6px 12px",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: "none",
    background: "none",
    color: rightPaneTab === "workspace" ? "var(--atlas-gold)" : "var(--atlas-muted)",
    borderBottom: rightPaneTab === "workspace" ? "2px solid var(--atlas-gold)" : "2px solid transparent",
  }}
>
  Workspace
</button>

// In the right pane content:
{rightPaneTab === "workspace" && (
  <IDEPanel
    projectId={projectId}
    onPushToGitHub={handlePushToGitHub}
  />
)}
```

### 7. API Hooks

Add to `lib/api.ts` or wherever you keep fetch wrappers:

```typescript
export async function listRuns(projectId: number): Promise<Run[]> {
  const res = await fetch(`/api/projects/${projectId}/runs`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch runs");
  return res.json();
}

export async function listGenerationRuns(projectId: number): Promise<GenerationRun[]> {
  const res = await fetch(`/api/projects/${projectId}/generation-runs`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch generation runs");
  return res.json();
}

export async function listGenerationFiles(projectId: number, runId: string): Promise<GeneratedFile[]> {
  const res = await fetch(`/api/projects/${projectId}/generation-runs/${runId}/files`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch files");
  return res.json();
}
```

### 8. Push to GitHub

Use the existing `FILE_EDIT` protocol. When the user clicks "Push to GitHub":

```typescript
async function pushToGitHub(projectId: number, files: Array<{ path: string; content: string }>) {
  const res = await fetch(`/api/github/write`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      files: files.map(f => ({ path: f.path, content: f.content })),
      message: "Atlas workspace update",
    }),
  });
  if (!res.ok) throw new Error("Push failed");
  return res.json();
}
```

### 9. Ambient Cross-Project Awareness

When Atlas generates code, the prompt already includes the user's `userProfile` (from localStorage) and the `projectMap` (from `atlas-scan-{id}`). The IDE panel should surface this context:

```typescript
// In the IDE panel header, show a subtle hint:
interface PortfolioContext {
  projectName: string;
  pattern: string;        // e.g. "Auth flow pattern from IntoIQ"
  relevance: string;      // why it matters for this run
}

// Fetch from a new endpoint (if you add it) or derive from userProfile
const portfolioHints = useMemo(() => {
  const profile = JSON.parse(localStorage.getItem("atlas-user-profile") || "{}");
  return profile.projects?.map((p: any) => ({
    projectName: p.name,
    pattern: p.lastPattern,
    relevance: p.relevanceToCurrent,
  })) || [];
}, []);
```

### 10. Immediate Visual Feedback

When Atlas is generating code, the IDE panel should show a live generation card:

```tsx
<LiveGenerationCard
  mode="edit"
  steps={[
    "Analyzing src/pages/login.tsx...",
    "Creating src/components/AuthForm.tsx...",
    "Updating src/lib/auth.ts...",
  ]}
  isComplete={false}
/>
```

This already exists as `LiveGenerationCard.tsx` in the repo. Use it directly.

## File List to Create

```
src/components/IDEPanel.tsx       // Main panel
src/components/IDERunList.tsx     // Run list
src/components/IDEFileTree.tsx    // File tree
src/components/IDEEditor.tsx      // CodeMirror wrapper
src/components/IDEDiffView.tsx    // Diff view
src/components/IDEActions.tsx     // Accept/Reject/Push buttons
src/hooks/useRuns.ts              // Data fetching hook
src/lib/api.ts                    // API functions (add to existing)
```

## Modify Existing Files

- `src/pages/workspace.tsx` — add "Workspace" tab, render `<IDEPanel>`
- `src/App.tsx` — no changes needed (no new routes)

## Package to Install

```bash
pnpm add @uiw/react-codemirror @uiw/codemirror-extensions-langs @codemirror/theme-one-dark @codemirror/view diff
```

## Design Rules

- No new routes. The IDE is a panel, not a page.
- Use Atlas design tokens (CSS vars listed above). No new color palettes.
- Mobile: the IDE panel slides up from bottom, full height, with a drag handle.
- Desktop: right pane, collapsible, resizable (optional).
- The editor is READ-ONLY by default. "Edit mode" toggle makes it editable.
- Files show diff by default. Click "View full" to see clean editor.
- Run list is the primary navigation. Files are secondary.
- Generation runs are the source of truth. Session `runStatus` is a fallback.

## Example Flow

1. User says: "Build a login page with email and password"
2. Atlas returns `FILE_EDIT` blocks
3. Backend saves them as `runArtifacts` on the session
4. Frontend sees the session now has `runStatus: "completed"`
5. IDE panel auto-opens (or user clicks Workspace tab)
6. Run list shows the new run: "Build login page — 3 files"
7. User clicks the run → file tree appears
8. User clicks `src/pages/login.tsx` → CodeMirror opens with the file
9. User sees diff view (green additions)
10. User clicks "Accept" → files are pushed to GitHub

## Critical: No New Routes

Do NOT add `/code` or `/project/:id/code` to the router. The IDE is a panel inside the workspace. The workspace URL stays `/project/:id`.

## Critical: Atlas Drives the Workspace

The IDE panel is passive. Atlas creates content via chat. The panel just displays what Atlas produced. The conversation is the primary interface. The workspace is the secondary view.

## After Building

Run typecheck. Verify the workspace page loads. The IDE panel should be hidden by default (behind the "Workspace" tab). When Atlas produces a `FILE_EDIT`, the panel should auto-show with a subtle pulse on the tab.
