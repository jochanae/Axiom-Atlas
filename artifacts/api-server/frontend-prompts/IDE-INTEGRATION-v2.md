# Cursor Prompt: Atlas Changes Review Panel

## Task
Build a "Changes Review" panel that slides into the workspace when Atlas generates code. No new routes. The panel shows a visual preview of what Atlas built, a summary of changes, and a "Ship It" button to push to GitHub.

## The User's Workflow
1. User says "Build a login page" → Atlas generates code (FILE_EDIT blocks)
2. Backend saves the files as `runArtifacts` on the session
3. Frontend sees `runStatus: "completed"` → the Changes panel auto-opens
4. User sees: (a) rendered preview of the login page, (b) summary of what changed, (c) collapsible file list
5. User taps "Ship It" → files push to GitHub via existing `POST /api/github/write`

## Backend Already Provides (in this Replit)

```typescript
// GET /api/projects/:projectId/runs → sessions with runStatus IS NOT NULL
interface Run {
  id: number;
  runStatus: string | null;     // "completed" | "in_progress" | "failed"
  runSummary: string | null;     // e.g. "Built login page with 3 files"
  runArtifacts: Array<{ type: "file"; label: string; meta: string }> | null;
  runActions: Array<{ verb: string; target: string; detail: string; status: string }> | null;
  // ... other session fields
}

// GET /api/sessions/:id/messages → chat messages
// The assistant message contains FILE_EDIT blocks with the actual code

// POST /api/github/write → pushes files to GitHub
// Body: { projectId, files: [{ path, content }], message }
```

## What to Build

### 1. Changes Panel Component → `src/components/ChangesPanel.tsx`

A slide-in panel that appears when `runStatus` is present.

```tsx
// Placement: inside workspace.tsx, conditionally rendered
{showChangesPanel && (
  <ChangesPanel
    run={currentRun}
    onShipIt={handleShipIt}
    onDismiss={() => setShowChangesPanel(false)}
    onAdjust={() => { /* focus chat input, panel stays open */ }}
  />
)}
```

### 2. Panel Layout (Mobile)

```
┌───────────────────────────────────────────────────────┐
│  ─── [Drag handle] ───                        │
│  3 files changed · Login page           ×  close  │
┌──────────────────────────────────────────────────────────────┤
│  [Preview]                                            │
│  ┌──────────────────────────────────────────────────┐│
│  │  [Rendered component preview]                  ││
│  │  (e.g., login page with fields + button)       ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  [Summary]                                            │
│  "Built login page with email/password fields,       │
│   validation, and dark theme styling."              │
│                                                      │
│  [Files] ▼                                          │
│  ● src/pages/login.tsx (created) · 89 lines       │
│  ● src/components/AuthForm.tsx (created) · 156     │
│  ● src/lib/auth.ts (modified) · 45 lines          │
│                                                      │
│  ───────────────────────────────────────────────────────────────┤
│  [SHIP IT] [Adjust] [Reject]                          │
└──────────────────────────────────────────────────────────────┘
```

### 3. Desktop (Folded) Layout

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  [Header] "Compani · 3 files changed"                          │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  [Chat]                            │ [Preview]                  │
│                                    │                            │
│  User: Build login page            │  [Rendered preview]         │
│                                    │  [Summary]                  │
│  Atlas: Done. Built...            │  [Files]                    │
│                                    │                            │
│  [Input]                           │  [SHIP IT] [Adjust] [Reject] │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The chat and preview panels have a **draggable divider** between them (width: 4px, cursor: col-resize, Atlas gold color on hover).

### 4. Component Code

**`src/components/ChangesPanel.tsx`**:

```tsx
import { useState } from "react";
import { diffLines } from "diff";

interface FileEdit {
  path: string;
  language: string;
  content: string;
  previousContent?: string;
}

interface ChangesPanelProps {
  run: {
    id: number;
    runSummary: string | null;
    runArtifacts: Array<{ type: string; label: string; meta: string }> | null;
    runActions: Array<{ verb: string; target: string; detail: string; status: string }> | null;
  };
  files: FileEdit[];
  onShipIt: () => void;
  onAdjust: () => void;
  onDismiss: () => void;
}

export function ChangesPanel({ run, files, onShipIt, onAdjust, onDismiss }: ChangesPanelProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "summary" | "files">("preview");
  const [showFiles, setShowFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Determine if mobile
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  if (isMobile) {
    return (
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: "70vh",
        background: "var(--atlas-surface)",
        borderTop: "1px solid var(--atlas-border)",
        borderRadius: "16px 16px 0 0",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
        overflow: "hidden",
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(120,113,108,0.4)" }} />
        </div>

        {/* Header */}
        <div style={{ padding: "0 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7 }}>
              {files.length} files changed
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--atlas-fg)", marginTop: 2 }}>
              {run.runSummary || "Changes"}
            </div>
          </div>
          <button onClick={onDismiss} style={{ background: "none", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 12px" }}>
          {/* Summary */}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(201,162,76,0.06)", border: "0.5px solid rgba(201,162,76,0.2)", marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "rgba(231,229,228,0.8)", lineHeight: 1.5 }}>
              {run.runSummary}
            </div>
          </div>

          {/* File list (collapsible) */}
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => setShowFiles(!showFiles)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "none", border: "none", color: "var(--atlas-muted)",
                fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.1em",
                textTransform: "uppercase", cursor: "pointer", padding: 0,
              }}
            >
              <span style={{ transform: showFiles ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 200ms", display: "inline-block" }}>▸</span>
              Files ({files.length})
            </button>
            {showFiles && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {files.map((f, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedFile(selectedFile === f.path ? null : f.path)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 10px", borderRadius: 6,
                      background: "var(--atlas-bg)", border: "0.5px solid var(--atlas-border)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: "rgba(134,239,172,0.8)", flexShrink: 0,
                    }} />
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-fg)", letterSpacing: "0.02em" }}>
                      {f.path}
                    </span>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", marginLeft: "auto", opacity: 0.5 }}>
                      {f.language}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* File preview (if selected) */}
          {selectedFile && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.5, marginBottom: 8 }}>
                {selectedFile}
              </div>
              <pre style={{
                background: "var(--atlas-bg)", border: "1px solid var(--atlas-border)", borderRadius: 8,
                padding: 10, fontSize: 10.5, fontFamily: "var(--app-font-mono)",
                color: "var(--atlas-fg)", overflow: "auto", maxHeight: 200,
                lineHeight: 1.6,
              }}>
                {files.find(f => f.path === selectedFile)?.content || ""}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--atlas-border)", display: "flex", gap: 8, background: "var(--atlas-surface)" }}>
          <button
            onClick={onShipIt}
            style={{
              flex: 1, height: 40, borderRadius: 8,
              background: "linear-gradient(180deg, var(--atlas-gold), rgba(201,162,76,0.8))",
              border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10.5,
              letterSpacing: "0.06em", color: "var(--atlas-bg)", fontWeight: 600,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            SHIP IT
          </button>
          <button
            onClick={onAdjust}
            style={{
              padding: "0 14px", height: 40, borderRadius: 8,
              border: "1px solid var(--atlas-border)", background: "transparent",
              fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-muted)",
              letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            Adjust
          </button>
          <button
            onClick={onDismiss}
            style={{
              width: 40, height: 40, borderRadius: 8,
              border: "1px solid var(--atlas-border)", background: "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "var(--atlas-muted)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Desktop: side panel or inline
  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      background: "var(--atlas-surface)",
      borderLeft: "1px solid var(--atlas-border)",
      overflow: "hidden",
    }}>
      {/* Tab bar */}
      <div style={{ height: 38, flexShrink: 0, display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--atlas-border)", paddingLeft: 8 }}>
        {[
          { label: "Preview", key: "preview" as const },
          { label: "Summary", key: "summary" as const },
          { label: "Files", key: "files" as const },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "0 14px",
              borderBottom: activeTab === t.key ? "2px solid var(--atlas-gold)" : "2px solid transparent",
              color: activeTab === t.key ? "var(--atlas-gold)" : "var(--atlas-muted)",
              cursor: "pointer", fontSize: 11,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              opacity: activeTab === t.key ? 1 : 0.55,
              background: "none", border: "none", borderBottomWidth: 2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {activeTab === "preview" && (
          <div>
            {/* Rendered preview placeholder */}
            <div style={{ fontSize: 13, color: "var(--atlas-muted)", textAlign: "center", padding: "40px 20px" }}>
              Visual preview of the rendered component goes here.
              <br />
              For now, use StackBlitz or an iframe with the generated HTML.
            </div>
          </div>
        )}
        {activeTab === "summary" && (
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(201,162,76,0.06)", border: "0.5px solid rgba(201,162,76,0.2)" }}>
            <div style={{ fontSize: 13, color: "rgba(231,229,228,0.8)", lineHeight: 1.5 }}>
              {run.runSummary}
            </div>
          </div>
        )}
        {activeTab === "files" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {files.map((f, i) => (
              <div
                key={i}
                onClick={() => setSelectedFile(selectedFile === f.path ? null : f.path)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", borderRadius: 6,
                  background: "var(--atlas-bg)", border: "0.5px solid var(--atlas-border)",
                  cursor: "pointer",
                }}
              >
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(134,239,172,0.8)", flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-fg)", letterSpacing: "0.02em" }}>{f.path}</span>
              </div>
            ))}
            {selectedFile && (
              <pre style={{
                background: "var(--atlas-bg)", border: "1px solid var(--atlas-border)", borderRadius: 8,
                padding: 10, fontSize: 10.5, fontFamily: "var(--app-font-mono)",
                color: "var(--atlas-fg)", overflow: "auto", maxHeight: 300,
                lineHeight: 1.6, marginTop: 8,
              }}>
                {files.find(f => f.path === selectedFile)?.content || ""}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--atlas-border)", display: "flex", gap: 10 }}>
        <button
          onClick={onShipIt}
          style={{
            flex: 1, height: 40, borderRadius: 8,
            background: "linear-gradient(180deg, var(--atlas-gold), rgba(201,162,76,0.8))",
            border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: 11,
            letterSpacing: "0.06em", color: "var(--atlas-bg)", fontWeight: 600,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          SHIP IT
        </button>
        <button
          onClick={onAdjust}
          style={{
            padding: "0 16px", height: 40, borderRadius: 8,
            border: "1px solid var(--atlas-border)", background: "transparent",
            fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-muted)",
            letterSpacing: "0.04em", cursor: "pointer",
          }}
        >
          Adjust
        </button>
        <button
          onClick={onDismiss}
          style={{
            width: 40, height: 40, borderRadius: 8,
            border: "1px solid var(--atlas-border)", background: "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "var(--atlas-muted)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
```

### 5. Integration into `workspace.tsx`

Find the right pane (around line 6900). Add a new tab "Changes" that appears when there's a run.

```tsx
// In workspace.tsx, add state:
const [rightPaneTab, setRightPaneTab] = useState<"ledger" | "changes" | "stackblitz">("ledger");
const [showChangesPanel, setShowChangesPanel] = useState(false);

// When a new run appears:
useEffect(() => {
  const lastRun = sessions?.find(s => s.runStatus === "completed");
  if (lastRun) {
    setShowChangesPanel(true);
    setRightPaneTab("changes");
  }
}, [sessions]);

// In the tab bar:
{sessions?.some(s => s.runStatus) && (
  <button
    onClick={() => setRightPaneTab("changes")}
    style={{
      padding: "6px 12px", fontSize: 11, textTransform: "uppercase",
      letterSpacing: "0.08em", border: "none", background: "none",
      color: rightPaneTab === "changes" ? "var(--atlas-gold)" : "var(--atlas-muted)",
      borderBottom: rightPaneTab === "changes" ? "2px solid var(--atlas-gold)" : "2px solid transparent",
    }}
  >
    Changes
  </button>
)}

// In the right pane content:
{rightPaneTab === "changes" && currentRun && (
  <ChangesPanel
    run={currentRun}
    files={currentRun.fileEdits || []}
    onShipIt={() => {
      // Push to GitHub
      fetch(`/api/github/write`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          files: currentRun.fileEdits?.map(f => ({ path: f.path, content: f.content })),
          message: currentRun.runSummary || "Atlas workspace update",
        }),
      });
    }}
    onAdjust={() => {
      // Focus chat input
      chatInputRef.current?.focus();
    }}
    onDismiss={() => setShowChangesPanel(false)}
  />
)}
```

### 6. The Draggable Divider (Desktop)

```tsx
// In workspace.tsx, for the main layout:
const [chatWidth, setChatWidth] = useState(420);
const [isDragging, setIsDragging] = useState(false);

// In the render:
<div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
  {/* Left: Chat */}
  <div style={{ width: chatWidth, flexShrink: 0, display: "flex", flexDirection: "column" }}>
    {/* ... chat content ... */}
  </div>

  {/* Draggable divider */}
  <div
    onMouseDown={() => setIsDragging(true)}
    style={{
      width: 4, flexShrink: 0, background: "var(--atlas-border)",
      cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center",
    }}
  >
    <div style={{ width: 2, height: 24, borderRadius: 1, background: "rgba(120,113,108,0.5)" }} />
  </div>

  {/* Right: Changes / Ledger / StackBlitz */}
  <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
    {/* ... tab content ... */}
  </div>
</div>

// In useEffect for drag handling:
useEffect(() => {
  const onMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setChatWidth(Math.max(300, Math.min(600, e.clientX)));
    }
  };
  const onMouseUp = () => setIsDragging(false);
  if (isDragging) {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }
  return () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };
}, [isDragging]);
```

### 7. Data Fetching

```tsx
// Hook to get runs for a project
function useRuns(projectId: number) {
  return useQuery({
    queryKey: ["runs", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runs`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch runs");
      return res.json();
    },
  });
}

// Hook to get file edits from a session
function useSessionFiles(sessionId: number) {
  return useQuery({
    queryKey: ["session-files", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const messages = await res.json();
      const assistantMsg = messages.find((m: any) => m.role === "assistant");
      // Parse FILE_EDIT blocks from the message content
      const files = parseFileEdits(assistantMsg?.content || "");
      return files;
    },
  });
}

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
```

### 8. Packages

```bash
pnpm add diff
```

### 9. Design Rules

- Atlas tokens only: `var(--atlas-bg)`, `var(--atlas-surface)`, `var(--atlas-fg)`, `var(--atlas-muted)`, `var(--atlas-gold)`, `var(--atlas-border)`
- No new colors. No gradients except the gold button.
- Mobile: sheet slides from bottom, max-height 70vh, draggable handle
- Desktop: side panel, draggable divider between chat and preview
- "SHIP IT" button is gold, always visible, primary action
- "Adjust" button focuses the chat input, panel stays open
- "Reject" button closes the panel
- Files section is collapsible, collapsed by default
- Code preview is read-only, monospace, max-height 200px
- No new routes. No `/code` page. Everything lives in workspace.

### 10. Order of Operations

1. Run `pnpm add diff`
2. Create `src/components/ChangesPanel.tsx`
3. Add `ChangesPanel` to `workspace.tsx` right pane
4. Add "Changes" tab to right pane tab bar
5. Add draggable divider logic
6. Run typecheck
7. Push to main
