# Frontend change: Auto-monitoring confirmation in deploy message

**File:** `src/pages/workspace.tsx`

Find the background deploy status fetch block (search for `after-push`):

```
// Background deploy status check — polls Vercel for up to 90 s after push
fetch("/api/deploy/after-push", { credentials: "include" })
  .then((r) => (r.ok ? r.json() : null))
  .then((data: { hasVercel?: boolean; status?: string; alias?: string; url?: string; visualQa?: DeployQa } | null) => {
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
        ...(data.visualQa ? { deployQa: data.visualQa } : {}),
      },
    ]);
  })
  .catch(() => {});
```

Replace the entire block with:

```
// Background deploy status check — polls Vercel for up to 90 s after push
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
  })
  .catch(() => {});
```

**What changed:**
- `fetch(...)` URL now appends `?atlasProjectId=${id}` — tells the backend which project this deploy belongs to so it can auto-register a scheduled health check.
- `data` type extended with `autoMonitoringSetUp?: boolean` and `autoMonitoringMessage?: string`.
- When `autoMonitoringSetUp` is true, `monitoringNote` appends the confirmation ("I've set up automatic monitoring for your app.") to the deploy success message.
- No other changes required — the `id` variable is already in scope at this call site.
