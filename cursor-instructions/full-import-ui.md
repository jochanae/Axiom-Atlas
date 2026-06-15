# Full Import UI — Deep Project Onboarding

## What this does
Adds a "Deep Import" button to the Files tab in the workspace. When tapped, it calls `POST /api/github/full-import`, which reads up to 15 key repo files, asks Claude to extract architectural decisions, and writes everything permanently to the project's memory and ledger — so Atlas knows the codebase from day one.

---

## File to edit: `src/components/workspace/FilesPanel.tsx`

Run `pnpm install` first if node_modules is missing.

---

### Step 1 — Add state (near line 268 where `scanStatus` is declared)

Find this line:
```
const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "done" | "error">("idle");
```

Directly below it, add:
```ts
const importKey = `atlas-full-import-${projectId}`;
const [importStatus, setImportStatus] = useState<"idle" | "importing" | "done" | "error">(() => {
  try { return localStorage.getItem(importKey) ? "done" : "idle"; } catch { return "idle"; }
});
const [importResult, setImportResult] = useState<{
  decisions: string[];
  tables: string[];
  stack: string[];
  ledgerEntriesCreated: number;
  summary: string | null;
} | null>(() => {
  try {
    const raw = localStorage.getItem(importKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
});
```

---

### Step 2 — Add the `runFullImport` function (directly below `runAutoScan`, around line 312)

Find this comment:
```
// Reset auto-load gate when project switches
```

Insert the following function immediately before that comment:
```ts
const runFullImport = () => {
  if (importStatus === "importing") return;
  const token = selectedRepo
    ? (localStorage.getItem(`atlas-github-token-${projectId}`) || localStorage.getItem("atlas-github-token") || "__server__")
    : "__server__";
  setImportStatus("importing");
  fetch("/api/github/full-import", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders(), "x-github-token": token },
    body: JSON.stringify({ projectId }),
  })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      const result = {
        decisions: data.decisions ?? [],
        tables: data.tables ?? [],
        stack: data.stack ?? [],
        ledgerEntriesCreated: data.ledgerEntriesCreated ?? 0,
        summary: data.summary ?? null,
      };
      try { localStorage.setItem(importKey, JSON.stringify(result)); } catch {}
      setImportResult(result);
      setImportStatus("done");
    })
    .catch(() => setImportStatus("error"));
};
```

---

### Step 3 — Reset import state when project switches (near line ~320 where other state resets happen)

Find this block (around line 315–325):
```
  autoLoadedRef.current = false;
  setSelectedRepo(null);
  setTree([]);
  setSelectedPath(null);
  setFileContent(null);
  setView(isConnected ? "tree" : "repos");
  setFilesSubTab("files");
  setCommits([]);
  setCommitsError(null);
```

Add these two lines at the end of that block:
```ts
  setImportStatus(localStorage.getItem(`atlas-full-import-${projectId}`) ? "done" : "idle");
  setImportResult(null);
```

---

### Step 4 — Render the import card in the file tree view

Find this line (around line 1132):
```
{filesSubTab === "files" && view === "tree" && (
```

Inside that section, find the very first `<div` that wraps the file tree content (it will have a `style` prop with `overflow: "auto"` or `flex: 1`).

**Before** that outermost tree wrapper div, insert this import card:

```tsx
{selectedRepo && (
  <div style={{
    margin: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${importStatus === "done" ? "rgba(201,162,76,0.25)" : "rgba(255,255,255,0.06)"}`,
    background: importStatus === "done" ? "rgba(201,162,76,0.04)" : "rgba(255,255,255,0.02)",
    padding: "10px 12px",
    flexShrink: 0,
  }}>
    {importStatus === "idle" && (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 2 }}>
            Deep Import
          </div>
          <div style={{ fontSize: 10, color: "var(--atlas-muted)", lineHeight: 1.4 }}>
            Atlas reads your repo and seeds your ledger with the architectural decisions already made.
          </div>
        </div>
        <button
          onClick={runFullImport}
          style={{
            flexShrink: 0,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid rgba(201,162,76,0.35)",
            background: "rgba(201,162,76,0.1)",
            color: "var(--atlas-gold)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.04em",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Import
        </button>
      </div>
    )}

    {importStatus === "importing" && (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--atlas-gold)", opacity: 0.7,
          animation: "pulse 1.2s ease-in-out infinite", flexShrink: 0,
        }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 1 }}>
            Analyzing repo…
          </div>
          <div style={{ fontSize: 10, color: "var(--atlas-muted)" }}>
            Reading files and extracting decisions. This takes ~20 seconds.
          </div>
        </div>
      </div>
    )}

    {importStatus === "done" && importResult && (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: "var(--atlas-gold)", fontWeight: 700, letterSpacing: "0.06em" }}>◆ IMPORTED</span>
          <span style={{ fontSize: 9, color: "var(--atlas-muted)" }}>
            {importResult.ledgerEntriesCreated} decision{importResult.ledgerEntriesCreated !== 1 ? "s" : ""} added to ledger
          </span>
          <button
            onClick={runFullImport}
            title="Re-run full import"
            style={{
              marginLeft: "auto", background: "transparent", border: "none",
              cursor: "pointer", color: "var(--atlas-muted)", fontSize: 9,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", opacity: 0.5,
              padding: "2px 4px",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "0.5"; }}
          >
            re-import
          </button>
        </div>
        {importResult.summary && (
          <p style={{ fontSize: 10, color: "var(--atlas-muted)", lineHeight: 1.5, margin: "0 0 6px" }}>
            {importResult.summary}
          </p>
        )}
        {importResult.decisions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {importResult.decisions.slice(0, 5).map((d, i) => (
              <span key={i} style={{
                fontSize: 9, padding: "2px 6px", borderRadius: 4,
                background: "rgba(201,162,76,0.08)", color: "var(--atlas-gold)",
                border: "0.5px solid rgba(201,162,76,0.2)",
              }}>
                {d.length > 40 ? d.slice(0, 40) + "…" : d}
              </span>
            ))}
          </div>
        )}
      </div>
    )}

    {importStatus === "error" && (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, fontSize: 10, color: "var(--atlas-muted)" }}>
          Import failed. Check your GitHub token in the Files tab.
        </div>
        <button
          onClick={runFullImport}
          style={{
            flexShrink: 0, padding: "5px 10px", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
            color: "var(--atlas-muted)", fontSize: 10, cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    )}
  </div>
)}
```

---

### Step 5 — Also add "Deep Import" to the "more" sheet in `workspace.tsx`

In `src/pages/workspace.tsx`, find this block (around line 6802):
```
...(hasLinkedRepo ? [{
  id: "rescan" as const,
  label: isScanning ? "Rescanning…" : "Rescan repo",
```

Directly **after** the closing `}] : [])` of the rescan block (the one ending around line 6817), add a new entry in the same array pattern:
```ts
...(hasLinkedRepo ? [{
  id: "fullimport" as const,
  label: "Deep Import",
  icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  onSelect: () => {
    setMobileTab("files");
    setShowMoreSheet(false);
    toast.info("Opening Files tab — tap Import to begin.", { className: "atlas-toast-pill" });
  },
}] : []),
```

---

Do not change anything else. Run typecheck, push to main.
