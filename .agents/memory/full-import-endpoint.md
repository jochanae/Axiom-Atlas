---
name: Full-import endpoint
description: POST /api/github/full-import — deep repo analysis that seeds project memory and ledger permanently.
---

# Full-Import Endpoint

## Route
`POST /api/github/full-import` — registered in `artifacts/api-server/src/routes/github.ts`

## Request body
```json
{ "projectId": 123, "repo": "owner/repo", "branch": "main" }
```
- `repo` and `branch` are optional — resolved from the project's `linkedRepo` if not provided.
- Requires `x-github-token` header (falls back to server token via `getToken(req)`).
- Requires auth (`requireAuth` is inherited from the github router mount in index.ts).

## What it does
1. Loads project + verifies ownership (userId must match)
2. Fetches full file tree from GitHub
3. Reads up to 15 key files (README, ARCHITECTURE, schema, routes, package.json, docs)
4. Calls Claude to extract: identity, 4–10 architectural decisions, stack, routes, tables, open questions
5. Writes to `projectsTable.memory` as v2 JSON (T1=decisions, T2=identity, T4=contextual, T3=event)
6. Merges with existing memory — strips old auto-import entries, keeps user-authored ones
7. Updates `description` if currently empty
8. Deletes old `verb="auto-import"` ledger entries, inserts fresh ones (idempotent on re-import)

## Response
```json
{
  "ok": true,
  "projectId": 123,
  "repo": "owner/repo",
  "filesRead": 12,
  "totalFiles": 847,
  "identity": { "name": "...", "description": "...", "stage": "in-progress", ... },
  "stack": ["React", "TypeScript", "Supabase"],
  "decisions": ["Use Supabase for auth and database", ...],
  "openQuestions": ["..."],
  "tables": ["users", "projects"],
  "routes": ["/", "/dashboard"],
  "ledgerEntriesCreated": 7,
  "summary": "..."
}
```

## Frontend Cursor prompt
`cursor-instructions/full-import-ui.md` — adds import card to FilesPanel.tsx (Files tab) and a "Deep Import" entry to the workspace "more" sheet.

**Why:** The original analyze scan only wrote to localStorage (evaporated on device switch). Full-import writes permanent v2 memory + ledger so Atlas knows the project on any device, any session.
