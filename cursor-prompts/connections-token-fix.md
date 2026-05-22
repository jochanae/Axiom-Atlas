# Fix: Connections Tab Reads Wrong Token Source

## Problem
The ConnectionsTab component currently reads the GitHub token from localStorage
(something like `localStorage.getItem("atlas-github-token")` or a per-project
variant). But the workspace already loads the token from the database via
`project.githubToken`. The result: the tab shows a red dot even when the token
is stored correctly in the project record.

## Fix
Pass the token and linked repo directly from the workspace's project data into
ConnectionsTab as props. No localStorage reads needed for display.

---

## File to edit
`artifacts/atlas/src/pages/workspace.tsx`

---

## Step 1 — Find the ConnectionsTab component definition

Search for `function ConnectionsTab` or `const ConnectionsTab` in workspace.tsx.

Find the props it accepts. It likely has something like:
```ts
function ConnectionsTab({ projectId }: { projectId: number }) {
```

And inside the body it reads the token something like:
```ts
const token = localStorage.getItem(`atlas-github-token-${projectId}`) 
           ?? localStorage.getItem("atlas-github-token") 
           ?? null;
const linkedRepo = localStorage.getItem(`atlas-linked-repo-${projectId}`) ?? null;
```

---

## Step 2 — Add props for token and repo

Change the props to also accept the token and linked repo directly:

```ts
function ConnectionsTab({
  projectId,
  githubToken,
  linkedRepo,
  dbUrl,
}: {
  projectId: number;
  githubToken: string | null;
  linkedRepo: string | null;
  dbUrl: string | null;
}) {
```

Inside the component body, **remove** the localStorage reads for `token` and
`linkedRepo`. Use the props directly instead:

```ts
// Remove these lines (or any equivalent localStorage reads for token/repo):
// const token = localStorage.getItem(...) 
// const linkedRepo = localStorage.getItem(...)

// The props are already:
// githubToken — from project.githubToken (DB source of truth)
// linkedRepo  — from project.linkedRepo  (DB source of truth)
```

Keep any localStorage reads for `dbUrl` — the database URL is not in the
project schema and stays in localStorage. The key for dbUrl is typically
`atlas-db-url-${projectId}`.

---

## Step 3 — Update the place where ConnectionsTab is rendered

Find where `<ConnectionsTab` is rendered inside `RightPanel` (or wherever it
appears in the JSX). It will look something like:

```tsx
{tab === "connections" && <ConnectionsTab projectId={projectId} />}
```

Update it to pass the project data:

```tsx
{tab === "connections" && (
  <ConnectionsTab
    projectId={projectId}
    githubToken={project?.githubToken ?? null}
    linkedRepo={project?.linkedRepo ?? null}
    dbUrl={(() => {
      try { return localStorage.getItem(`atlas-db-url-${projectId}`); }
      catch { return null; }
    })()}
  />
)}
```

Where `project` is the project object already loaded in the workspace
(the same object used by `FilesTab` and the chat system).

---

## Step 4 — Token display logic

The `githubToken` value in the DB is stored as an encrypted string with the
prefix `enc:v1:` (e.g. `enc:v1:ghp_abc123...`).

In the ConnectionsTab display, where you show the token value, update the
masking logic:

```ts
// Instead of showing the raw enc:v1: prefix, show a clean masked display:
const tokenDisplay = githubToken
  ? (githubToken.startsWith("enc:v1:") ? "Token saved ••••••••" : `${githubToken.slice(0, 4)}••••••••`)
  : null;
```

And the green/red dot condition:
```ts
const hasToken = !!githubToken; // green if project.githubToken exists
```

---

## Step 5 — Typecheck

```
pnpm --filter @workspace/atlas run typecheck
```

Zero errors before pushing.
