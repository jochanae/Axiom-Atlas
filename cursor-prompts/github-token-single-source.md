# GitHub Token — Single Source of Truth (workspace.tsx)

## What this fixes
The GitHub token lives in `localStorage` as `atlas-github-token`, but the
`POST /api/chat` fetch never sent it. The backend was resolving the token from
the database — which can be stale, empty on first use, or simply out of sync.

Result: Atlas would say "no token" or silently fail on file reads even when
the token was sitting right there in localStorage.

**The fix**: send `x-github-token` with every chat request. The backend now
uses it as the highest priority — fresh localStorage value wins every time.

---

## File to change
`src/pages/workspace.tsx`

---

## The one change needed

Find the `fetch("/api/chat", ...)` call inside `doSend`. It currently looks like:

```ts
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
```

Replace it with:

```ts
      fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getGlobalToken() ? { "x-github-token": getGlobalToken()! } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
```

`getGlobalToken()` is already defined earlier in the same file:
```ts
const getGlobalToken = () => { try { return localStorage.getItem("atlas-github-token") || null; } catch { return null; } };
```

If that function is defined inside `FilesTab` and not accessible from `doSend`,
use this inline version instead:

```ts
      const ghToken = (() => { try { return localStorage.getItem("atlas-github-token") || null; } catch { return null; } })();

      fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ghToken ? { "x-github-token": ghToken } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
```

---

## Run typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this does

- The GitHub token in localStorage is now the single source of truth for all
  chat requests
- Atlas can read files from linked repos from the very first message, even
  before the DB has synced the token
- No more "no token available" failures when the token is clearly present
- The backend still falls back to the account token → project DB token →
  server token if localStorage is empty
