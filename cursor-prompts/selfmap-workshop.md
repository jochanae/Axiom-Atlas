# Workshop — Atlas Selfmap Tool

## Context
The backend route `POST /api/selfmap/refresh` is live. It walks the entire codebase (frontend + backend), builds a structured index of every file (exports, imports, relationships), stores it in the DB, and returns `{ file_count: number, created_at: string }`. No request body needed.

This prompt adds a sixth tool card to the Workshop page — "Atlas Selfmap" — that lets you trigger the index rebuild and see when it last ran.

---

## File to change
`src/pages/workshop.tsx`

---

## Step 1 — Add `atlas-selfmap` to the Tool type

Find this line near the top of the file:

```ts
type Tool = "decision-editor" | "context-builder" | "diff-review" | "session-exporter" | "bulk-import";
```

Replace with:

```ts
type Tool = "decision-editor" | "context-builder" | "diff-review" | "session-exporter" | "bulk-import" | "atlas-selfmap";
```

---

## Step 2 — Add the tool card to the `tools` array

Find the closing of the `tools` array — the last object ending with `},` before the closing `]`. Add this entry after the last tool:

```ts
{
  id: "atlas-selfmap" as Tool,
  icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  ),
  label: "Atlas Selfmap",
  desc: "Rebuild Atlas's structural index of the entire codebase — files, exports, and relationships.",
},
```

---

## Step 3 — Wire the tool panel

Find this block (the series of `if (activeTool === ...)` checks before the `return`):

```ts
if (activeTool === "bulk-import") return <BulkImport projects={projects} onBack={() => setActiveTool(null)} />;
```

Add immediately after it:

```ts
if (activeTool === "atlas-selfmap") return <AtlasSelfmap onBack={() => setActiveTool(null)} />;
```

---

## Step 4 — Add the `AtlasSelfmap` component

Add this new component at the very end of the file, after the last function (`BulkImport` or whichever is last):

```tsx
/* ─── Tool 6: Atlas Selfmap ─── */
function AtlasSelfmap({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<{ file_count: number; created_at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setStatus("running");
    setError(null);
    try {
      const res = await fetch("/api/selfmap/refresh", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { file_count: number; created_at: string };
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    }
  };

  const monoLabel: React.CSSProperties = {
    fontFamily: "var(--app-font-mono)",
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "var(--atlas-muted)",
    opacity: 0.7,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 4,
  };

  return (
    <ToolShell
      title="Atlas Selfmap"
      desc="Structural index of the entire codebase"
      onBack={onBack}
    >
      <div style={{ marginBottom: 20, padding: "14px", borderRadius: 10, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div style={{ fontSize: 12.5, color: "var(--atlas-muted)", lineHeight: 1.7, marginBottom: 16, opacity: 0.8 }}>
          Atlas will walk every <code style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, background: "rgba(201,162,76,0.08)", padding: "1px 5px", borderRadius: 3 }}>.ts</code> and <code style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, background: "rgba(201,162,76,0.08)", padding: "1px 5px", borderRadius: 3 }}>.tsx</code> file in the frontend and backend, extract all exports and import relationships, and store the result in the database. This is used to give Atlas deeper structural awareness of the codebase when answering architecture questions.
        </div>

        <button
          type="button"
          onClick={run}
          disabled={status === "running"}
          style={{
            width: "100%",
            padding: "11px",
            borderRadius: 8,
            background: status === "running" ? "var(--atlas-border)" : "var(--atlas-gold)",
            color: status === "running" ? "var(--atlas-muted)" : "#0D0B09",
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: status === "running" ? "default" : "pointer",
            transition: "background 140ms",
            letterSpacing: "-0.01em",
          }}
        >
          {status === "running" ? "Indexing codebase…" : "Run Selfmap"}
        </button>
      </div>

      {status === "done" && result && (
        <div style={{ padding: "14px", borderRadius: 10, background: "color-mix(in oklab, var(--atlas-gold) 6%, transparent)", border: "1px solid rgba(201,162,76,0.25)" }}>
          <span style={monoLabel}>Last run</span>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 6 }}>
            {result.file_count} files indexed
          </div>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.65 }}>
            {new Date(result.created_at).toLocaleString()}
          </div>
        </div>
      )}

      {status === "error" && error && (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "color-mix(in oklab, var(--atlas-ember) 8%, transparent)", border: "1px solid rgba(146,64,14,0.3)" }}>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-ember)", opacity: 0.9 }}>{error}</div>
        </div>
      )}
    </ToolShell>
  );
}
```

---

## Step 5 — Run typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this does
- Adds a 6th card in Workshop → "Atlas Selfmap"
- Tapping it opens the tool panel with a description and a **Run Selfmap** button
- The button calls `POST /api/selfmap/refresh`, shows a spinner during the run
- On success: shows file count + timestamp in a gold confirmation box
- On error: shows the error message in ember red
- No project picker needed — selfmap is global (indexes the whole codebase)
- `ToolShell`, `monoLabel` style, all design tokens match the existing Workshop style exactly
