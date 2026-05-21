---
name: Terminal SSE ordering — flush before repo prep
description: SSE headers must be sent before prepareProjectRepo or the user sees a silent hang
---

In `artifacts/api-server/src/routes/terminal.ts`, `res.flushHeaders()` (SSE setup) must happen BEFORE `prepareProjectRepo()` is called. Repo cloning can take 5–30 seconds on a cold sandbox. If SSE isn't open yet, the frontend gets no feedback and the request appears frozen.

**Why:** `prepareProjectRepo` is async and blocks on `git clone`/`git pull`/`npm install`. The `onStatus` callback emits SSE events during this wait — but only works if headers are already flushed.

**How to apply:** Always follow this order in `/terminal/exec`:
1. Validate inputs (400 if bad)
2. Evaluate tier (403/json if blocked, json if requiresConfirmation)
3. Flush SSE headers + define `send()`
4. Call `prepareProjectRepo` with `onStatus: (msg) => send("status", msg)`
5. Call `executeTerminalCommand`

Error handling after SSE is open must use `send("error", msg); res.end()` not `res.status().json()`.
