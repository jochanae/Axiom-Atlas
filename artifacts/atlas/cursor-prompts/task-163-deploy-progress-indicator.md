# Task 163 — Show "Deploy in progress…" indicator while Vercel is building

## What this does

After a FILE_EDIT push, the user waits up to 90 seconds for the Vercel deploy poll to resolve.
Previously the chat sat silent during this window. This change injects a "Deploy in progress…"
system message immediately after the push, then transitions it to "Deployed ✓" (or "Deploy failed")
when the poll resolves. If Vercel is not configured, the placeholder is silently removed.

## File to edit

`src/pages/workspace.tsx`

---

## Change 1 — Add `deployInProgress` to the `ChatMessage` interface

Find the `ChatMessage` interface (search for `interface ChatMessage {`). Add the new field after `deployQa`:

**Find this exact block:**
```ts
  browserResult?: BrowserResult | null;
  deployQa?: DeployQa | null;
}
```

**Replace with:**
```ts
  browserResult?: BrowserResult | null;
  deployQa?: DeployQa | null;
  deployInProgress?: boolean;
}
```

---

## Change 2 — Inject in-progress placeholder and update the after-push fetch chain

Find the comment `// Background deploy status check — polls Vercel for up to 90 s after push.`
and the entire block that follows it (the `fetch('/api/deploy/after-push?...') .then(...) .catch(...)` chain).

**Find this exact block** (it starts just before the fetch call and ends with `.catch(() => {})`):

```ts
                    // Background deploy status check — polls Vercel for up to 90 s after push.
                    // When Vercel is configured, BROWSER_VISIT is deferred until after-push confirms
                    // the deploy is "ready" — this prevents visiting a mid-deploy / stale snapshot.
                    fetch(`/api/deploy/after-push?atlasProjectId=${id}`, { credentials: "include" })
                      .then((r) => (r.ok ? r.json() : null))
                      .then((data: { hasVercel?: boolean; status?: string; alias?: string; url?: string; visualQa?: DeployQa; autoMonitoringSetUp?: boolean; autoMonitoringMessage?: string } | null) => {
                        if (!data?.hasVercel) return;
                        const host = data.alias
                          ? `https://${data.alias}`
                          : data.url
                            ? `https://${data.url}`
                            : null;
                        const monitoringNote = data.autoMonitoringSetUp && data.autoMonitoringMessage
                          ? `\n\n${data.autoMonitoringMessage}`
                          : "";
                        const content =
                          data.status === "ready"
                            ? `Deployed ✓${host ? `\n\nLive at ${host}` : ""}${monitoringNote}`
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
                            ...(data.visualQa ? { deployQa: data.visualQa } : {}),
                          },
                        ]);
                        // Trigger the post-deploy health check now that the site is confirmed live.
                        // The backend gates BROWSER_VISIT on this signal when Vercel is connected,
                        // so the health badge reflects the actual deployed state, not mid-deploy.
                        if (data.status === "ready" && sessionId) {
                          const liveNote = host ? ` Live at ${host}.` : "";
                          doSend(
                            `DEPLOY_READY_VISIT:${liveNote} Run post-deploy health check now.`,
                            sessionId,
                            messagesRef.current,
                          );
                        }
                      })
                      .catch(() => {});
```

**Replace with:**

```ts
                    // Show 'Deploy in progress…' immediately — removed if Vercel isn't configured.
                    setMessages((prev) => [
                      ...prev,
                      {
                        role: "assistant" as const,
                        content: "Deploy in progress…",
                        model: "system",
                        intentType: "BUILD",
                        sentAt: new Date().toISOString(),
                        deployInProgress: true,
                      },
                    ]);
                    // Background deploy status check — polls Vercel for up to 90 s after push.
                    // When Vercel is configured, BROWSER_VISIT is deferred until after-push confirms
                    // the deploy is "ready" — this prevents visiting a mid-deploy / stale snapshot.
                    fetch(`/api/deploy/after-push?atlasProjectId=${id}`, { credentials: "include" })
                      .then((r) => (r.ok ? r.json() : null))
                      .then((data: { hasVercel?: boolean; status?: string; alias?: string; url?: string; visualQa?: DeployQa; autoMonitoringSetUp?: boolean; autoMonitoringMessage?: string } | null) => {
                        if (!data?.hasVercel) {
                          setMessages((prev) => prev.filter((m) => !m.deployInProgress));
                          return;
                        }
                        const host = data.alias
                          ? `https://${data.alias}`
                          : data.url
                            ? `https://${data.url}`
                            : null;
                        const monitoringNote = data.autoMonitoringSetUp && data.autoMonitoringMessage
                          ? `\n\n${data.autoMonitoringMessage}`
                          : "";
                        const content =
                          data.status === "ready"
                            ? `Deployed ✓${host ? `\n\nLive at ${host}` : ""}${monitoringNote}`
                            : data.status === "failed"
                              ? "Deploy failed. Check your Vercel dashboard — the build may need a fix."
                              : null;
                        if (!content) {
                          // Timeout or unknown status — remove placeholder silently
                          setMessages((prev) => prev.filter((m) => !m.deployInProgress));
                          return;
                        }
                        // Replace the in-progress placeholder with the final deploy result
                        setMessages((prev) =>
                          prev.map((m) =>
                            m.deployInProgress
                              ? {
                                  ...m,
                                  content,
                                  deployInProgress: false,
                                  ...(data.visualQa ? { deployQa: data.visualQa } : {}),
                                }
                              : m,
                          ),
                        );
                        // Trigger the post-deploy health check now that the site is confirmed live.
                        // The backend gates BROWSER_VISIT on this signal when Vercel is connected,
                        // so the health badge reflects the actual deployed state, not mid-deploy.
                        if (data.status === "ready" && sessionId) {
                          const liveNote = host ? ` Live at ${host}.` : "";
                          doSend(
                            `DEPLOY_READY_VISIT:${liveNote} Run post-deploy health check now.`,
                            sessionId,
                            messagesRef.current,
                          );
                        }
                      })
                      .catch(() => {
                        setMessages((prev) => prev.filter((m) => !m.deployInProgress));
                      });
```

---

## After applying

Run typecheck, then push to main:

```
pnpm --filter @workspace/atlas run typecheck
```

Do not change anything else.
