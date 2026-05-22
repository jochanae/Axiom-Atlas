# Atlas DB Awareness — Phase 1 Frontend (workspace.tsx)

## Context
The backend now accepts a `dbUrl` field on every `POST /api/chat` request.
When present, Atlas inspects the database schema before responding and injects
a live table/column map into its system prompt — so it can say things like
"I see your projects table has no status column" or "The recipes table is missing."

This prompt does two things:
1. Adds a **DB Connection** input section in the Files tab (same location as the GitHub token)
2. Sends the stored `dbUrl` with every workspace chat request

The DB URL is stored in `localStorage` per project as `atlas-db-url-{projectId}`.
It is **never** sent to any server except the Axiom backend, where it is used
only for read-only `information_schema` queries and is never stored.

---

## File to change
`src/pages/workspace.tsx`

---

## Step 1 — Store and load dbUrl state in the main workspace component

In the main workspace component (the large function that holds `doSend`, `fileContext`,
`forgeContext`, etc.), find the block where `fileContext` state is declared:

```ts
  const [fileContext, setFileContext] = useState<string | null>(null);
```

Add these two lines immediately after it:

```ts
  const [dbUrl, setDbUrl] = useState<string | null>(() => {
    try { return localStorage.getItem(`atlas-db-url-${id}`) ?? null; } catch { return null; }
  });
```

---

## Step 2 — Reload dbUrl when project ID changes

Find the `useEffect` that reloads forge context when `id` changes — it looks like:

```ts
  useEffect(() => {
    try { setForgeContext(sessionStorage.getItem(`atlas-forge-ctx-${id}`) ?? null); } catch { setForgeContext(null); }
  }, [id]);
```

Add a new `useEffect` immediately after it:

```ts
  useEffect(() => {
    try { setDbUrl(localStorage.getItem(`atlas-db-url-${id}`) ?? null); } catch { setDbUrl(null); }
  }, [id]);
```

---

## Step 3 — Pass dbUrl into the doSend body

Find the `body` object inside `doSend` (it spreads `fileContext`, `userProfile`, `projectMap`, etc.):

```ts
      ...(forgeContext ? { forgeContext } : {}),
```

Add one more spread immediately after it:

```ts
      ...(dbUrl ? { dbUrl } : {}),
```

---

## Step 4 — Pass dbUrl and setDbUrl into the right-pane component

Find where `FilesTab` receives `projectId`, `onFileContext`, and `onLinkedRepoChange`.
The right-pane component that contains FilesTab is called something like `RightPane` or
is an inline JSX block. Find the place where `<FilesTab` is rendered:

```tsx
      {tab === "files" && <FilesTab projectId={projectId} onFileContext={onFileContext} onLinkedRepoChange={onLinkedRepoChange} />}
```

Replace with:

```tsx
      {tab === "files" && <FilesTab projectId={projectId} onFileContext={onFileContext} onLinkedRepoChange={onLinkedRepoChange} dbUrl={dbUrl} onDbUrlChange={setDbUrl} />}
```

---

## Step 5 — Add dbUrl props to the FilesTab function signature

Find the `FilesTab` function declaration:

```ts
function FilesTab({
  projectId,
  onFileContext,
  onLinkedRepoChange,
}: {
  projectId: number;
  onFileContext: (ctx: string | null) => void;
  onLinkedRepoChange: (repo: LinkedRepo | null) => void;
}) {
```

Replace with:

```ts
function FilesTab({
  projectId,
  onFileContext,
  onLinkedRepoChange,
  dbUrl,
  onDbUrlChange,
}: {
  projectId: number;
  onFileContext: (ctx: string | null) => void;
  onLinkedRepoChange: (repo: LinkedRepo | null) => void;
  dbUrl: string | null;
  onDbUrlChange: (url: string | null) => void;
}) {
```

---

## Step 6 — Add DB Connection UI inside FilesTab

Find the end of the `FilesTab` main return — the section where the repo file tree
and GitHub settings are shown. Specifically, find a `</div>` that closes the main
scrollable content area inside FilesTab. You want to add the DB section just before
the closing of the scroll container.

A good anchor to find: look for where the GitHub token is displayed/changed in the
connected state — there's usually a small settings section at the bottom with a token
input or a "Change token" link. Add the DB section right after that block.

Here is the component to add:

```tsx
{/* ── DB Connection ── */}
<div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--atlas-border)" }}>
  <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.13em", color: "var(--atlas-muted)", opacity: 0.65, textTransform: "uppercase", marginBottom: 8 }}>
    Database Connection
  </div>
  {dbUrl ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0, display: "inline-block" }} />
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-fg)", opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {dbUrl.replace(/:[^:@]*@/, ":***@")}
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          const newUrl = prompt("Paste new PostgreSQL connection string (or leave blank to remove):");
          if (newUrl === null) return;
          if (!newUrl.trim()) {
            try { localStorage.removeItem(`atlas-db-url-${projectId}`); } catch {}
            onDbUrlChange(null);
          } else {
            try { localStorage.setItem(`atlas-db-url-${projectId}`, newUrl.trim()); } catch {}
            onDbUrlChange(newUrl.trim());
          }
        }}
        style={{ fontSize: 10, color: "var(--atlas-muted)", background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", alignSelf: "flex-start", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}
      >
        Change
      </button>
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.6, lineHeight: 1.6 }}>
        Paste your project's Postgres connection string so Atlas can inspect its schema.
      </div>
      <DbUrlInput projectId={projectId} onSave={(url) => { onDbUrlChange(url); }} />
    </div>
  )}
</div>
```

---

## Step 7 — Add the DbUrlInput helper component

Add this small component just before the `FilesTab` function definition:

```tsx
function DbUrlInput({ projectId, onSave }: { projectId: number; onSave: (url: string) => void }) {
  const [value, setValue] = React.useState("");

  const save = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try { localStorage.setItem(`atlas-db-url-${projectId}`, trimmed); } catch {}
    onSave(trimmed);
    setValue("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        placeholder="postgres://user:pass@host/db"
        autoComplete="off"
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--atlas-surface)",
          border: "1px solid var(--atlas-border)",
          color: "var(--atlas-fg)",
          fontSize: 11,
          fontFamily: "var(--app-font-mono)",
          outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
      />
      <button
        type="button"
        disabled={!value.trim()}
        onClick={save}
        style={{
          padding: "7px",
          borderRadius: 6,
          background: value.trim() ? "var(--atlas-gold)" : "var(--atlas-surface)",
          border: "none",
          color: value.trim() ? "#0D0B09" : "var(--atlas-muted)",
          fontSize: 10,
          fontFamily: "var(--app-font-mono)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: value.trim() ? "pointer" : "not-allowed",
        }}
      >
        Connect
      </button>
    </div>
  );
}
```

> **Note:** If `React` is not in scope at that location, use `useState` directly
> (it should already be imported at the top of the file).
> Replace `React.useState("")` with `useState("")`.

---

## Step 8 — Run typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this does

- **Files tab** now has a "Database Connection" section at the bottom (below GitHub settings)
- When no DB URL is set: shows a password-masked input + Connect button
- When connected: shows the URL with credentials masked (`user:***@host`), and a Change button
- The URL is saved to `localStorage` as `atlas-db-url-{projectId}` — never sent to any server except with chat requests
- Every `POST /api/chat` request now includes `dbUrl` when one is set
- Atlas immediately starts including live schema context in its responses:
  > "I can see your database has a `projects` table with `id`, `name`, `status`, and `created_at` columns. The `project_status` field doesn't exist yet — here's how to add it..."
- Works for any Postgres-compatible DB: Neon, Supabase, Railway Postgres, plain Postgres
- The connection string is used only for read-only `information_schema` queries — no writes, no storage
