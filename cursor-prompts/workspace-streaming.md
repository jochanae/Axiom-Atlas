# Workspace Chat — SSE Streaming (Token-by-Token)

## Context
The backend (`POST /api/chat`) now streams tokens as `event: token` SSE events before the final `event: done`. The frontend currently calls `r.json()` on this response, which silently drops all streamed tokens. This prompt wires the workspace chat to read the SSE stream and show tokens as they arrive — the same way the home chat already works.

---

## File to change
`src/pages/workspace.tsx`

---

## Step 1 — Find the Message type, add `streaming` field

Find the type/interface for chat messages in the workspace (likely something like `WorkspaceMessage` or the inline type used by `messages` state). Add one field:

```ts
streaming?: boolean;
```

---

## Step 2 — Replace the `/api/chat` fetch with an SSE stream reader

Find this block (around the `fetch("/api/chat", ...)` call in the `sendMessage`/`handleSendMessage` callback). It currently looks like:

```ts
fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: controller.signal,
})
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then((res) => {
    // ... processes res.content, res.catchPayload, res.fileEdits, etc.
  })
  .catch(...)
  .finally(() => { setChatPending(false); abortControllerRef.current = null; });
```

Replace the entire fetch block with the async SSE reader below. Keep ALL the existing logic from inside the `.then((res) => { ... })` block — just move it into the `done` event handler. Do not change anything else.

```ts
(async () => {
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

    // Add a streaming placeholder bubble immediately
    const streamingId = `stream-${Date.now()}`;
    let streamedText = "";
    setMessages((prev) => [
      ...prev,
      {
        id: streamingId,
        role: "assistant" as const,
        content: "",
        streaming: true,
        sentAt: new Date().toISOString(),
      },
    ]);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";

      for (const block of blocks) {
        let evtName = "";
        let evtData = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) evtName = line.slice(7).trim();
          else if (line.startsWith("data: ")) evtData = line.slice(6);
        }
        if (!evtData) continue;

        try {
          if (evtName === "token") {
            const chunk = JSON.parse(evtData) as string;
            streamedText += chunk;
            setMessages((prev) =>
              prev.map((m) =>
                (m as any).id === streamingId
                  ? { ...m, content: streamedText }
                  : m
              )
            );
          } else if (evtName === "narration") {
            // narration events drive the activity bar — no bubble update needed
            const msg = JSON.parse(evtData) as string;
            setActivityStream({ active: true, content: msg });
          } else if (evtName === "done") {
            const res = JSON.parse(evtData);

            // Remove the streaming placeholder
            setMessages((prev) => prev.filter((m) => (m as any).id !== streamingId));

            // ── paste your existing .then((res) => { ... }) logic here verbatim ──
            // Everything from the LENS_DRIFT check down to the autoName block.
            // Example skeleton (replace with your actual code):

            if (res.content && typeof res.content === "string") {
              const driftMatch = res.content.match(/LENS_DRIFT:\s*(flow|build|look|scenario)/i);
              if (driftMatch) {
                const drifted = driftMatch[1].toLowerCase();
                if (drifted !== sendCtxRef.current.wsLens) setDetectedLens(drifted as any);
                res.content = res.content.replace(/\n?LENS_DRIFT:\s*(flow|build|look|scenario)\s*$/i, "").trim();
              } else {
                setDetectedLens(null);
              }
            }
            const cp = res.catchPayload ?? null;
            const ap = res.alertPayload ?? null;
            const fes = (res.fileEdits ?? (res.fileEdit ? [res.fileEdit] : []));
            const lps = (res.linePatches ?? []);
            const aff = (res.autoFetchedFiles ?? []);
            setActivityStream({
              active: true,
              content: [
                res.content ?? "",
                res.plan?.mode === "blueprint" ? "BLUEPRINT" : res.plan ? "PLAN" : "",
                aff.length > 0 ? "FILE_READ" : "",
                fes.length > 0 ? "FILE_EDIT" : "",
                lps.length > 0 ? "LINE_PATCH" : "",
              ].filter(Boolean).join("\n"),
            });
            const rawChips = res.memoryChips ?? [];
            const normalizedChips = rawChips.map((c: any) =>
              typeof c === "string" ? { label: c } : c
            );
            setMessages((prev) => [
              ...prev,
              {
                id: res.messageId,
                role: "assistant",
                content: res.content,
                intentType: res.intentType,
                catchPayload: cp,
                ...(ap ? { alertPayload: ap } : {}),
                ...(res.plan ? { plan: res.plan } : {}),
                sentAt: new Date().toISOString(),
                model: res.model ?? wsModel,
                isDeepDive: !!res.isDeepDive,
                ...(fes.length > 0 ? { fileEdits: fes, fileEdit: fes[0] } : {}),
                ...(lps.length > 0 ? { linePatches: lps } : {}),
                ...(normalizedChips.length > 0 ? { memoryChips: normalizedChips } : {}),
                ...(res.imageB64 ? { imageB64: res.imageB64, imageMimeType: res.imageMimeType } : {}),
                ...(aff.length > 0 ? { autoFetchedFiles: aff } : {}),
              },
            ]);
            if (isScenario) {
              setScenarioBuffer((prev) => [
                ...prev,
                { role: "user", content: text },
                { role: "assistant", content: res.content ?? "" },
              ]);
            }
            if (fes && fes.length > 0) {
              setLeftTab("diff");
              setMobileTab("preview");
            }
            if (cp) { playCatch(); setActiveCatch(cp); }
            if (normalizedChips.length > 0) {
              setMemoryChips((prev) => {
                const merged = [...prev];
                for (const c of normalizedChips) {
                  if (!merged.some((m) => m.label === c.label)) merged.push(c);
                }
                return merged.slice(-12);
              });
            }
            if (res.resolvedNodes && res.resolvedNodes.length > 0) {
              setPendingResolvedNodeIds((prev) => {
                const merged = [...prev];
                for (const id of res.resolvedNodes) {
                  if (!merged.includes(id)) merged.push(id);
                }
                return merged;
              });
            }
            if (res.autoName && typeof res.autoName === "string") {
              setAutoNameKey((k) => k + 1);
              queryClient.setQueryData(getGetProjectQueryKey(id), (old: unknown) => {
                if (old && typeof old === "object" && "name" in old) return { ...(old as object), name: res.autoName };
                return old;
              });
              queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            }
          }
        } catch {
          // malformed event — skip
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      setActivityStream({ active: false, content: "" });
      return;
    }
    void reportError(err, { projectId: id });
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Something went wrong. Please try again.", sentAt: new Date().toISOString() },
    ]);
    setActivityStream({ active: false, content: "" });
  } finally {
    setChatPending(false);
    abortControllerRef.current = null;
  }
})();
```

---

## Step 3 — Render the streaming bubble

Find where assistant chat messages are rendered in the JSX (the `.map()` over `messages`). Add a streaming indicator so the user sees text appearing live. When `msg.streaming === true`, the bubble should show the text so far with a blinking cursor or faded style to signal it's in-progress. 

The simplest version — wrap the content render with:

```tsx
{msg.streaming ? (
  <span style={{ opacity: 0.85 }}>
    {msg.content}
    <span style={{ display: "inline-block", width: 8, height: "1em", background: "currentColor", marginLeft: 2, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />
  </span>
) : (
  // your existing content render
)}
```

Add this CSS somewhere (global stylesheet or a `<style>` tag in the component):
```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

---

## What NOT to change
- Do not touch the flow mode fetch (the other `/api/chat` call that has `.then(r => r.ok ? r.json() : ...)` — that one stays as JSON since flow mode doesn't need streaming).
- Do not change any other file.
- Do not change the `body` construction or any logic above the fetch call.

---

## After the change
Run typecheck and push to main. The backend already emits `event: token` events — this frontend change is what makes them visible.
