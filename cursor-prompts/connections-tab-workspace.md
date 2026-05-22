# Connections Tab — Workspace Right Pane (workspace.tsx)

## What this builds
A dedicated **Connections** tab in the workspace right pane (same row as
Ledger, Files, Memory, Flow). One glance shows every external connection for
the current project — GitHub repo, GitHub token, database — with a green/red
status dot and a direct action button. No more hunting through the Files tab
for credentials.

---

## File to change
`src/pages/workspace.tsx`

---

## Step 1 — Add "connections" to the RightTab type

Find this line (near the top of the file, around line 154):

```ts
type RightTab = "ledger" | "files" | "preview" | "memory" | "map" | "terminal";
```

Replace with:

```ts
type RightTab = "ledger" | "files" | "preview" | "memory" | "map" | "terminal" | "connections";
```

---

## Step 2 — Add the Connections tab to the tabs array

Find the `tabs` array inside `RightPanel`. It ends with the `terminal` entry
inside a spread. Find the spread for terminal:

```ts
    ...(wsLens === "build" || wsLens === "scenario" ? [{
      id: "terminal" as RightTab,
      label: "Terminal",
```

Add the Connections entry **before** that spread (so it appears before Terminal):

```ts
    {
      id: "connections" as RightTab,
      label: "Connections",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="12" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6.5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M1.5 5.5C1.5 3.5 3 2 4 2M1.5 10.5C1.5 12.5 3 14 4 14" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity={0.45} />
          <path d="M14.5 5.5C14.5 3.5 13 2 12 2M14.5 10.5C14.5 12.5 13 14 12 14" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity={0.45} />
        </svg>
      ),
    },
    ...(wsLens === "build" || wsLens === "scenario" ? [{
      id: "terminal" as RightTab,
      label: "Terminal",
```

---

## Step 3 — Render the ConnectionsTab in the content area

Find the block where tab content is rendered. It contains:

```tsx
      {tab === "files" && <FilesTab projectId={projectId} onFileContext={onFileContext} onLinkedRepoChange={onLinkedRepoChange} />}
```

Add the connections case immediately after that line:

```tsx
      {tab === "connections" && <ConnectionsTab projectId={projectId} onSwitchToFiles={() => setTab("files")} />}
```

---

## Step 4 — Add the ConnectionsTab component

Add this entire component to the file just before the `RightPanel` function
definition (look for the comment `// ── RightPanel (tabbed)`):

```tsx
// ── ConnectionsTab ────────────────────────────────────────────────────────────
function ConnectionsTab({
  projectId,
  onSwitchToFiles,
}: {
  projectId: number;
  onSwitchToFiles: () => void;
}) {
  const { data: project } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });

  // Read token from localStorage (single source of truth after token fix)
  const [ghToken, setGhToken] = React.useState<string | null>(null);
  const [dbUrl, setDbUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    try { setGhToken(localStorage.getItem("atlas-github-token")); } catch {}
    try { setDbUrl(localStorage.getItem(`atlas-db-url-${projectId}`)); } catch {}
  }, [projectId]);

  // Parse linked repo
  let linkedRepo: { fullName?: string } | null = null;
  try {
    if (project?.linkedRepo) {
      const parsed = JSON.parse(project.linkedRepo) as string | { fullName?: string };
      linkedRepo = typeof parsed === "string" ? { fullName: parsed } : parsed;
    }
  } catch {}

  const repoName = linkedRepo?.fullName ?? null;
  const maskedToken = ghToken ? `${ghToken.slice(0, 7)}${"•".repeat(8)}` : null;
  const maskedDb = dbUrl ? dbUrl.replace(/:[^:@]*@/, ":•••@") : null;

  const DOT_GREEN = "rgba(74,222,128,0.9)";
  const DOT_RED = "rgba(248,113,113,0.85)";

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "11px 14px",
    borderBottom: "1px solid var(--atlas-border)",
  };

  const dotStyle = (connected: boolean): React.CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: 4,
    background: connected ? DOT_GREEN : DOT_RED,
    boxShadow: connected
      ? "0 0 6px rgba(74,222,128,0.4)"
      : "0 0 6px rgba(248,113,113,0.3)",
  });

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--app-font-mono)",
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--atlas-muted)",
    opacity: 0.65,
    marginBottom: 3,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 11.5,
    color: "var(--atlas-fg)",
    opacity: 0.85,
    fontFamily: "var(--app-font-mono)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const missingStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(248,113,113,0.75)",
    fontStyle: "italic",
  };

  const actionBtn: React.CSSProperties = {
    marginTop: 6,
    padding: "3px 9px",
    borderRadius: 5,
    border: "1px solid var(--atlas-border)",
    background: "transparent",
    color: "var(--atlas-gold)",
    fontSize: 10,
    fontFamily: "var(--app-font-mono)",
    letterSpacing: "0.07em",
    cursor: "pointer",
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "7px 14px",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 9,
            letterSpacing: "0.13em",
            textTransform: "uppercase" as const,
            color: "var(--atlas-muted)",
            opacity: 0.55,
          }}
        >
          Project Connections
        </span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* GitHub Repo */}
        <div style={rowStyle}>
          <div style={dotStyle(!!repoName)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={labelStyle}>GitHub Repo</div>
            {repoName ? (
              <div style={valueStyle}>{repoName}</div>
            ) : (
              <div style={missingStyle}>No repo linked</div>
            )}
            <button
              type="button"
              onClick={onSwitchToFiles}
              style={actionBtn}
            >
              {repoName ? "Manage →" : "Link repo →"}
            </button>
          </div>
        </div>

        {/* GitHub Token */}
        <div style={rowStyle}>
          <div style={dotStyle(!!ghToken)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={labelStyle}>GitHub Token</div>
            {maskedToken ? (
              <div style={valueStyle}>{maskedToken}</div>
            ) : (
              <div style={missingStyle}>No token — file reads disabled</div>
            )}
            <button
              type="button"
              onClick={onSwitchToFiles}
              style={actionBtn}
            >
              {ghToken ? "Change →" : "Add token →"}
            </button>
          </div>
        </div>

        {/* Database */}
        <div style={rowStyle}>
          <div style={dotStyle(!!dbUrl)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={labelStyle}>Database</div>
            {maskedDb ? (
              <div style={valueStyle}>{maskedDb}</div>
            ) : (
              <div style={missingStyle}>No database connected</div>
            )}
            <button
              type="button"
              onClick={onSwitchToFiles}
              style={actionBtn}
            >
              {dbUrl ? "Change →" : "Connect →"}
            </button>
          </div>
        </div>

        {/* Summary footer */}
        <div
          style={{
            padding: "12px 14px",
            marginTop: 4,
          }}
        >
          {[!!repoName, !!ghToken, !!dbUrl].every(Boolean) ? (
            <div
              style={{
                fontSize: 11,
                color: "rgba(74,222,128,0.75)",
                fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.04em",
              }}
            >
              All connections active — Atlas has full context.
            </div>
          ) : (
            <div
              style={{
                fontSize: 11,
                color: "var(--atlas-muted)",
                opacity: 0.55,
                lineHeight: 1.6,
              }}
            >
              {[
                !repoName && "Link a GitHub repo so Atlas can read and write files.",
                !ghToken && "Add a GitHub token to enable file reading.",
                !dbUrl && "Connect a database so Atlas can reference your schema.",
              ]
                .filter(Boolean)
                .map((msg, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    · {msg}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

> **Note:** If `React` is not in scope (file uses named imports like
> `import { useState, useEffect } from "react"`), replace `React.useState`
> with `useState` and `React.useEffect` with `useEffect` throughout the
> component above. Both should already be imported at the top of the file.

---

## Step 5 — Run typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this looks like

```
CONNECTIONS
──────────────────────────────────────────
●  GITHUB REPO
   jochanae/Axiom-Atlas
   [Manage →]

●  GITHUB TOKEN
   ghp_abc••••••••
   [Change →]

●  DATABASE
   postgres://user:•••@neon.tech/db
   [Change →]

All connections active — Atlas has full context.
──────────────────────────────────────────
```

Or if something's missing:

```
●  GITHUB REPO
   No repo linked
   [Link repo →]                       ← red dot

●  GITHUB TOKEN
   No token — file reads disabled      ← red dot
   [Add token →]

· Link a GitHub repo so Atlas can read and write files.
· Add a GitHub token to enable file reading.
```

All "Manage →" / "Link →" / "Change →" / "Connect →" buttons switch directly
to the Files tab where the action can be completed. No dead ends.
