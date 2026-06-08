# Cursor Prompt: Atlas Visual Preview Integration

## What You Need To Build

Integrate a **live visual preview** of Atlas-generated code into the existing workspace. When Atlas generates code (FILE_EDIT blocks), the user sees the rendered component in real-time — not raw code.

## Backend Now Provides

```
GET /api/preview/session/:sessionId
```

Returns a **full HTML page** (not JSON) that renders the latest FILE_EDIT from that session as a live React component. Just load it in an iframe — the page includes React 18, Babel, and your Atlas theme.

**Response:** `text/html` with `X-Frame-Options: ALLOWALL` (safe to iframe)

## What to Change

### 1. Add `previewUrl` to `PreviewTab` props

In `workspace.tsx`, find the `PreviewTab` function (around line 4851). Add a `sessionId` prop:

```tsx
function PreviewTab({ projectId, sandboxCode, onSandboxConsumed, refreshTrigger, sessionId }: {
  projectId: number;
  sandboxCode?: string | null;
  onSandboxConsumed?: () => void;
  refreshTrigger?: number;
  sessionId?: number;  // <-- ADD THIS
})
```

### 2. Add state for the generated preview

Inside `PreviewTab`, add:

```tsx
// Generated preview from Atlas
const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(null);

// When sessionId changes, fetch the preview
useEffect(() => {
  if (!sessionId) {
    setGeneratedPreviewUrl(null);
    return;
  }
  // Build the preview URL
  const url = `/api/preview/session/${sessionId}`;
  setGeneratedPreviewUrl(url);
}, [sessionId]);
```

### 3. Add a new preview mode: "generated"

Find the `previewMode` state (around line 4862):

```tsx
const [previewMode, setPreviewMode] = useState<"url" | "sandbox" | "local" | "generated">("url");
```

### 4. Auto-switch to "generated" mode when preview URL is available

Add this effect inside `PreviewTab`:

```tsx
useEffect(() => {
  if (generatedPreviewUrl) {
    setPreviewMode("generated");
  }
}, [generatedPreviewUrl]);
```

### 5. Render the generated preview

In the `PreviewTab` return, after the `sandbox` mode block (around line 5519), add:

```tsx
{previewMode === "generated" && generatedPreviewUrl && (
  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", letterSpacing: "0.05em" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--atlas-gold)", display: "inline-block", boxShadow: "0 0 6px rgba(201,162,76,0.5)" }} />
        Atlas Generated
      </span>
      <div style={{ flex: 1 }} />
      <button
        onClick={() => setPreviewMode("url")}
        style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px", color: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", borderRadius: 4, opacity: 0.55, transition: "opacity 140ms" }}
        onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={e => (e.currentTarget.style.opacity = "0.55")}
      >
        Back to URL
      </button>
    </div>
    <div style={{ flex: 1, position: "relative" }}>
      <iframe
        key={generatedPreviewUrl}
        src={generatedPreviewUrl}
        title="Atlas Preview"
        sandbox="allow-scripts allow-same-origin"
        style={{ border: "none", width: "100%", height: "100%", display: "block", background: "var(--atlas-bg)" }}
      />
    </div>
  </div>
)}
```

### 6. Wire `sessionId` from the workspace chat

Find the `PreviewTab` usage in `workspace.tsx` (search for `<PreviewTab`). Pass the current session ID:

```tsx
<PreviewTab
  projectId={projectId}
  sandboxCode={sandboxCode}
  onSandboxConsumed={...}
  refreshTrigger={...}
  sessionId={activeSessionId}  // <-- ADD THIS
/>
```

### 7. Detect when a run is completed and auto-open the Preview tab

In the main workspace component, add polling for runs:

```tsx
// Poll for completed runs
const [latestRun, setLatestRun] = useState<any | null>(null);

useEffect(() => {
  if (!projectId) return;
  const poll = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/runs`);
      if (!res.ok) return;
      const runs = await res.json();
      const completed = runs.find((r: any) => r.runStatus === "completed");
      if (completed) {
        setLatestRun(completed);
      }
    } catch {}
  };
  const iv = setInterval(poll, 3000);
  return () => clearInterval(iv);
}, [projectId]);
```

### 8. Auto-switch to Preview tab when a run completes

Pass `forceTab` to the right panel:

```tsx
// When a new run completes, force the preview tab
useEffect(() => {
  if (latestRun?.runStatus === "completed") {
    // This will trigger the right panel to switch to "preview"
    setForceTab("preview");
  }
}, [latestRun]);
```

## Summary of What Happens Now

1. User says "Build a login page" in workspace chat
2. Atlas generates FILE_EDIT blocks
3. Backend stores them and sets `runStatus: "completed"`
4. Frontend polls `/api/projects/:id/runs` every 3 seconds
5. Sees completed run → switches to Preview tab
6. Preview tab loads `/api/preview/session/:sessionId` in an iframe
7. User sees the **live rendered login page** — not raw code
8. User can click "Back to URL" to return to their live deployment

## Design Notes

- The generated preview uses your Atlas theme (dark background, gold accents)
- It includes an error boundary — broken code shows a red error banner instead of crashing
- The iframe is sandboxed (`allow-scripts allow-same-origin`) for security
- The preview URL is session-scoped — it always shows the latest code from that session

## Testing

1. Open a workspace chat
2. Ask Atlas to "build a simple button component"
3. Wait for the response to complete
4. The Preview tab should auto-open and show a rendered button
5. If you see "No FILE_EDIT blocks found" — Atlas didn't generate code in that format

## Do Not Change

- The existing `url`, `sandbox`, and `local` preview modes stay as-is
- The `PreviewTab` component stays inside `workspace.tsx`
- Don't create new routes — this is a conditional render inside the existing tab
