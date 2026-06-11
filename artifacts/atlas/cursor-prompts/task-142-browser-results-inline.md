# Cursor Prompt — Show browser screenshots and health reports inline in workspace chat

**File:** `src/pages/workspace.tsx`

---

Run `pnpm install` first if node_modules is missing.

Make the following changes to `src/pages/workspace.tsx`. Do not change anything else.

---

## Change 1 — Add `BrowserResult` and `DeployQa` types before the `ChatMessage` interface

Find this exact block (around line 122–124):

```typescript
}

interface ChatMessage {
```

Replace it with:

```typescript
}

interface BrowserResult {
  type: "screenshot" | "scrape" | "health" | "monitor";
  url: string;
  screenshotBase64?: string;
  analysis?: string;
  isHealthy?: boolean;
  issues?: string[];
  hasErrors?: boolean;
  consoleErrors?: string[];
  resourceErrors?: string[];
  errorPatterns?: string[];
  summary?: string;
}

interface DeployQa {
  isHealthy: boolean;
  issues: string[];
  analysis?: string;
  screenshotBase64?: string;
}

interface ChatMessage {
```

---

## Change 2 — Add `browserResult` and `deployQa` fields to `ChatMessage`

Find this exact block inside the `ChatMessage` interface:

```typescript
  terminalCmd?: { command: string; tier?: string } | null;
  terminalResult?: { command: string; output: string; exitCode: number | null } | null;
}
```

Replace it with:

```typescript
  terminalCmd?: { command: string; tier?: string } | null;
  terminalResult?: { command: string; output: string; exitCode: number | null } | null;
  browserResult?: BrowserResult | null;
  deployQa?: DeployQa | null;
}
```

---

## Change 3 — Map `browserResult` from API response when setting messages

Find this exact block (the `setMessages` call that adds the assistant message after a chat response):

```typescript
            ...(tCmd ? { terminalCmd: tCmd } : {}),
            ...(tRes ? { terminalResult: tRes } : {}),
          }]);
```

Replace it with:

```typescript
            ...(tCmd ? { terminalCmd: tCmd } : {}),
            ...(tRes ? { terminalResult: tRes } : {}),
            ...(res.browserResult ? { browserResult: res.browserResult as BrowserResult } : {}),
          }]);
```

---

## Change 4 — Map `deployQa` from the after-push deploy response and include it in the system message

Find this exact block (the `.then` handler for the after-push fetch):

```typescript
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

Replace it with:

```typescript
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

---

## Change 5 — Render `browserResult` and `deployQa` inline in the AssistantMessage component

Find this exact closing block after the imageB64 section:

```tsx
        )}

        {message.autoFetchedFiles && message.autoFetchedFiles.length > 0 && (
```

Replace it with:

```tsx
        )}

        {message.browserResult && (
          <div style={{ marginBottom: 14 }}>
            {/* URL label */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                <circle cx="8" cy="8" r="6" stroke="var(--atlas-gold)" strokeWidth="1.3" />
                <path d="M8 2C8 2 5.5 5 5.5 8s2.5 6 2.5 6M8 2c0 0 2.5 3 2.5 6S8 14 8 14M2 8h12" stroke="var(--atlas-gold)" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, maxWidth: 260 }}>
                {message.browserResult.url}
              </span>
            </div>

            {/* Screenshot */}
            {message.browserResult.screenshotBase64 && (
              <img
                src={message.browserResult.screenshotBase64}
                alt="Browser screenshot"
                style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid rgba(201,162,76,0.2)", display: "block", width: "100%", marginBottom: message.browserResult.analysis ? 8 : 0 }}
              />
            )}

            {/* Health / monitor badge */}
            {(message.browserResult.type === "health" || message.browserResult.type === "monitor") && (
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {message.browserResult.type === "health" ? (
                    message.browserResult.isHealthy ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 5, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "rgba(134,239,172,0.9)", fontWeight: 700 }}>
                        ✓ HEALTHY
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 5, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "rgba(252,165,165,0.9)", fontWeight: 700 }}>
                        ✗ ISSUES
                      </span>
                    )
                  ) : (
                    message.browserResult.hasErrors ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 5, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "rgba(252,165,165,0.9)", fontWeight: 700 }}>
                        ✗ RUNTIME ERRORS
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 5, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "rgba(134,239,172,0.9)", fontWeight: 700 }}>
                        ✓ NO ERRORS
                      </span>
                    )
                  )}
                </div>
                {message.browserResult.issues && message.browserResult.issues.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: "rgba(252,165,165,0.75)", lineHeight: 1.7 }}>
                    {message.browserResult.issues.slice(0, 5).map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                )}
                {message.browserResult.consoleErrors && message.browserResult.consoleErrors.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: "rgba(252,165,165,0.75)", lineHeight: 1.7 }}>
                    {message.browserResult.consoleErrors.slice(0, 5).map((err, i) => (
                      <li key={i} style={{ fontFamily: "var(--app-font-mono)", fontSize: 10 }}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Analysis text */}
            {message.browserResult.analysis && (
              <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.78, lineHeight: 1.65, marginTop: 6 }}>
                {message.browserResult.analysis}
              </div>
            )}

            {/* Scrape summary */}
            {message.browserResult.type === "scrape" && !message.browserResult.analysis && message.browserResult.summary && (
              <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.78, lineHeight: 1.65, marginTop: 6 }}>
                {message.browserResult.summary}
              </div>
            )}
          </div>
        )}

        {message.deployQa && (
          <div style={{ marginTop: 10, marginBottom: 10, padding: "10px 14px", borderRadius: 8, background: message.deployQa.isHealthy ? "rgba(74,222,128,0.04)" : "rgba(239,68,68,0.04)", border: `1px solid ${message.deployQa.isHealthy ? "rgba(74,222,128,0.2)" : "rgba(239,68,68,0.2)"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: message.deployQa.issues.length > 0 || message.deployQa.analysis ? 8 : 0 }}>
              <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", fontWeight: 700, color: message.deployQa.isHealthy ? "rgba(134,239,172,0.9)" : "rgba(252,165,165,0.9)" }}>
                VISUAL QA — {message.deployQa.isHealthy ? "✓ HEALTHY" : "✗ ISSUES FOUND"}
              </span>
            </div>
            {message.deployQa.screenshotBase64 && (
              <img
                src={message.deployQa.screenshotBase64}
                alt="Deploy preview"
                style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid rgba(201,162,76,0.15)", display: "block", width: "100%", marginBottom: 8 }}
              />
            )}
            {message.deployQa.issues.length > 0 && (
              <ul style={{ margin: "0 0 6px", paddingLeft: 16, fontSize: 11, color: "rgba(252,165,165,0.75)", lineHeight: 1.7 }}>
                {message.deployQa.issues.slice(0, 5).map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            {message.deployQa.analysis && (
              <div style={{ fontSize: 12, color: "var(--atlas-fg)", opacity: 0.72, lineHeight: 1.6 }}>
                {message.deployQa.analysis}
              </div>
            )}
          </div>
        )}

        {message.autoFetchedFiles && message.autoFetchedFiles.length > 0 && (
```

---

Run typecheck, push to main.
