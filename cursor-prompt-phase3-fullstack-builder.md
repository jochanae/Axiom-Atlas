# Phase 3: Full-Stack Builder — Frontend Changes
**Apply these changes to `jochanae/atlas-idk` workspace.tsx**

---

## Change 1 — Deploy status chain after GitHub push

### What this does
After the user approves a FILE_EDIT and pushes to GitHub, the app now silently polls the backend (`/api/deploy/after-push`) for up to 90 seconds. When the Vercel deployment finishes, a "Deployed ✓ / Live at https://..." message appears automatically in the chat. If the user has no Vercel connection, nothing happens.

### File
`src/pages/workspace.tsx`

### Find this exact block (in the `onPushSuccess` callback inside the main AssistantBubble message list render, around line ~11017)

```typescript
                    // Close the FILE_EDIT loop — tell Atlas the push landed so it can continue
                    if (sessionId) {
                      const plural = records.length > 1 ? `${records.length} files` : `"${records[0]?.filename}"`;
                      const confirmNote = commitUrl ? ` Commit: ${commitUrl}` : "";
                      doSend(
                        `FILE_EDIT_CONFIRMED: ${plural} pushed to ${branch}.${confirmNote} Continue.`,
                        sessionId,
                        messagesRef.current,
                      );
                    }
```

### Replace with

```typescript
                    // Close the FILE_EDIT loop — tell Atlas the push landed so it can continue
                    if (sessionId) {
                      const plural = records.length > 1 ? `${records.length} files` : `"${records[0]?.filename}"`;
                      const confirmNote = commitUrl ? ` Commit: ${commitUrl}` : "";
                      doSend(
                        `FILE_EDIT_CONFIRMED: ${plural} pushed to ${branch}.${confirmNote} Continue.`,
                        sessionId,
                        messagesRef.current,
                      );
                    }
                    // Background deploy status check — polls Vercel for up to 90 s after push
                    fetch("/api/deploy/after-push", { credentials: "include" })
                      .then((r) => (r.ok ? r.json() : null))
                      .then((data: { hasVercel?: boolean; status?: string; alias?: string; url?: string } | null) => {
                        if (!data?.hasVercel) return;
                        const host = data.alias
                          ? `https://${data.alias}`
                          : data.url
                            ? `https://${data.url}`
                            : null;
                        const content =
                          data.status === "ready"
                            ? `Deployed ✓${host ? `\n\nLive at ${host}` : ""}`
                            : data.status === "failed"
                              ? "Deploy failed. Check your Vercel dashboard — the build may need a fix."
                              : null;
                        if (!content) return;
                        setMessages((prev) => [
                          ...prev,
                          {
                            role: "assistant" as const,
                            content,
                            model: "system",
                            intentType: "BUILD",
                            sentAt: new Date().toISOString(),
                          },
                        ]);
                      })
                      .catch(() => {});
```

### Note
Do not change anything else. Run typecheck, push to main.

---

## Context — What the backend does

`GET /api/deploy/after-push` (new backend endpoint — deployed to Cloud Run):
- If user has no Vercel connection → returns `{ hasVercel: false }` immediately (no UI change)
- If user has a Vercel connection → polls every 5 s for up to 90 s until deployment is `ready` or `failed`
- Returns `{ hasVercel: true, status: "ready"|"failed"|"building"|"timeout", alias: "yourapp.vercel.app", url: "..." }`
- Timeout after 90 s returns `{ hasVercel: true, status: "timeout" }` → frontend shows nothing (expected for slow builds)

The deploy poll runs in the background. It doesn't block the Atlas chat response. Vercel builds typically take 30–120 s after a push, so the "Deployed ✓" message will appear naturally in the chat a minute or so after the push succeeds.

---

## Typecheck note

The `data` parameter in the `.then()` call uses an inline type annotation. If the workspace has strict `any` linting, you can cast it instead:

```typescript
.then((r) => (r.ok ? (r.json() as Promise<{ hasVercel?: boolean; status?: string; alias?: string; url?: string }>) : Promise.resolve(null)))
.then((data) => {
```

Either form compiles fine with standard TypeScript strict mode.
