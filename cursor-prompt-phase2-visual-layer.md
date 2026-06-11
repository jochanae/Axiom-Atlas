# Cursor Prompt — Phase 2: Visual Layer (Inline-to-Canvas)

Apply these changes to `jochanae/atlas-idk` (the live frontend repo).

> **Upgrading from the earlier image-wiring prompt?**
> If you already applied `cursor-prompt-workspace-images.md`, this prompt **replaces** that earlier wiring. The old version used `imageUrl` (a data URL string on the ImageVersion object) and `activeCanvasVersion` (the full object). This new version uses `dataUrl` and `activeCanvasVersionId` (just the id string). The new `CanvasPanel.tsx` is a complete rewrite — overwrite the old file. For the workspace state, **replace** the old `imageVersions` / `activeCanvasVersion` declarations with the new ones in Change 5.

---

## Step 1 — Run install first

```
pnpm install
```

---

## Step 2 — Create new file: `src/components/CanvasPanel.tsx`

Create this file exactly:

```tsx
import { useState, useRef, useCallback } from "react";
import type React from "react";

export interface ImageVersion {
  id: string;
  dataUrl: string;
  prompt?: string;
  createdAt: string;
}

interface CanvasPanelProps {
  versions: ImageVersion[];
  activeVersionId: string | null;
  onVersionSelect: (id: string) => void;
  onRefine: (prompt: string) => void;
  onClose: () => void;
  mode?: "modal" | "inline";
}

export function CanvasPanel({
  versions,
  activeVersionId,
  onVersionSelect,
  onRefine,
  onClose,
  mode = "modal",
}: CanvasPanelProps) {
  const [refineInput, setRefineInput] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const active = versions.find((v) => v.id === activeVersionId) ?? versions[versions.length - 1] ?? null;

  const handleRefine = useCallback(async () => {
    const text = refineInput.trim();
    if (!text || refineLoading) return;
    setRefineLoading(true);
    setRefineInput("");
    try {
      await onRefine(text);
    } finally {
      setRefineLoading(false);
    }
  }, [refineInput, refineLoading, onRefine]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleRefine();
      }
    },
    [handleRefine]
  );

  const containerStyle: React.CSSProperties =
    mode === "modal"
      ? {
          position: "fixed",
          inset: 0,
          zIndex: 200,
          display: "flex",
          flexDirection: "column",
          background: "var(--atlas-bg)",
        }
      : {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "var(--atlas-bg)",
          borderLeft: "1px solid var(--atlas-border)",
        };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1" y="1" width="14" height="14" rx="2" stroke="var(--atlas-gold)" strokeWidth="1.2" />
            <path d="M1 10l4-4 3 3 3-4 4 5" stroke="var(--atlas-gold)" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: "var(--atlas-gold)",
              textTransform: "uppercase",
            }}
          >
            VISUAL CANVAS
          </span>
          {versions.length > 1 && (
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 9,
                color: "var(--atlas-muted)",
                letterSpacing: "0.06em",
              }}
            >
              v{versions.findIndex((v) => v.id === active?.id) + 1} / {versions.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          title="Close canvas"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "transparent",
            border: "1px solid var(--atlas-border)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--atlas-muted)",
            flexShrink: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Main image area */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          position: "relative",
        }}
      >
        {active ? (
          <img
            src={active.dataUrl}
            alt="Generated visual"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 10,
              border: "1px solid rgba(201,162,76,0.2)",
              boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              color: "var(--atlas-muted)",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
              <rect x="2" y="2" width="28" height="28" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
              <circle cx="11" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2 22l8-8 6 6 4-5 10 9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 12, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}>
              No visual yet
            </span>
          </div>
        )}
      </div>

      {/* Version history strip */}
      {versions.length > 1 && (
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--atlas-border)",
            padding: "8px 12px",
            overflowX: "auto",
            display: "flex",
            gap: 6,
            scrollbarWidth: "none",
          }}
        >
          {versions.map((v, i) => (
            <button
              key={v.id}
              onClick={() => onVersionSelect(v.id)}
              title={v.prompt ?? `Version ${i + 1}`}
              style={{
                flexShrink: 0,
                width: 52,
                height: 52,
                borderRadius: 7,
                overflow: "hidden",
                border: v.id === activeVersionId
                  ? "2px solid var(--atlas-gold)"
                  : "1px solid var(--atlas-border)",
                cursor: "pointer",
                background: "var(--atlas-surface)",
                padding: 0,
                opacity: v.id === activeVersionId ? 1 : 0.6,
                transition: "opacity 160ms, border-color 160ms",
                position: "relative",
              }}
            >
              <img
                src={v.dataUrl}
                alt={`v${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 1,
                  right: 3,
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 7,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.7)",
                  letterSpacing: "0.04em",
                }}
              >
                v{i + 1}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Refinement input */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--atlas-border)",
          padding: "10px 12px",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={textareaRef}
          value={refineInput}
          onChange={(e) => setRefineInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={refineLoading}
          placeholder={active ? "Refine this visual…" : "Describe what to generate…"}
          rows={2}
          style={{
            flex: 1,
            resize: "none",
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 8,
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-sans)",
            fontSize: 12.5,
            padding: "8px 10px",
            outline: "none",
            lineHeight: 1.5,
            opacity: refineLoading ? 0.55 : 1,
          }}
        />
        <button
          onClick={() => void handleRefine()}
          disabled={!refineInput.trim() || refineLoading}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: refineInput.trim() && !refineLoading ? "var(--atlas-ember)" : "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            cursor: refineInput.trim() && !refineLoading ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "background 160ms",
          }}
        >
          {refineLoading ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
              style={{ animation: "atlas-spin 0.8s linear infinite" }}
            >
              <circle cx="6" cy="6" r="5" stroke="var(--atlas-muted)" strokeWidth="1.5" strokeDasharray="16 10" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6h8M7 3l3 3-3 3" stroke="var(--atlas-fg)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
```

---

## Step 3 — Edit `src/pages/workspace.tsx`

### Change 1: Add import near the other component imports (after the Eye/TerminalSquare import line)

Find this line:
```
import { Eye, TerminalSquare } from "lucide-react";
```

Add immediately after it:
```tsx
import { CanvasPanel } from "../components/CanvasPanel";
import type { ImageVersion } from "../components/CanvasPanel";
```

---

### Change 2: Add `onOpenCanvas` to AssistantBubble interface

Find this block (in the AssistantBubble props interface):
```
  trustMode: "review" | "auto";
  agenticMode?: boolean;
  onEditDeclined?: () => void;
  onAlertDismiss?: () => void;
```

Add one line at the end:
```
  onOpenCanvas?: (dataUrl: string) => void;
```

---

### Change 3: Destructure `onOpenCanvas` in AssistantBubble

Find this block near the top of the AssistantBubble function params:
```
  trustMode,
  agenticMode,
  onEditDeclined,
  onAlertDismiss,
}: {
```

Change to:
```
  trustMode,
  agenticMode,
  onEditDeclined,
  onAlertDismiss,
  onOpenCanvas,
}: {
```

---

### Change 4: Make inline image tappable

Find this block inside AssistantBubble:
```tsx
        {message.imageB64 && (
          <div style={{ marginBottom: 12 }}>
            <img
              src={`data:${message.imageMimeType ?? "image/png"};base64,${message.imageB64}`}
              alt="Generated visual"
              style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid rgba(201,162,76,0.2)", display: "block" }}
            />
          </div>
        )}
```

Replace with:
```tsx
        {message.imageB64 && (
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => {
                const dataUrl = `data:${message.imageMimeType ?? "image/png"};base64,${message.imageB64}`;
                onOpenCanvas?.(dataUrl);
              }}
              title="Tap to open in canvas"
              style={{
                display: "block",
                padding: 0,
                background: "none",
                border: "none",
                cursor: "pointer",
                width: "100%",
                borderRadius: 10,
                position: "relative",
              }}
            >
              <img
                src={`data:${message.imageMimeType ?? "image/png"};base64,${message.imageB64}`}
                alt="Generated visual"
                style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid rgba(201,162,76,0.2)", display: "block", width: "100%" }}
              />
              <div style={{
                position: "absolute",
                bottom: 8,
                right: 8,
                background: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(4px)",
                borderRadius: 5,
                padding: "3px 7px",
                fontSize: 9,
                fontFamily: "var(--app-font-mono)",
                color: "rgba(201,162,76,0.9)",
                letterSpacing: "0.08em",
                pointerEvents: "none",
              }}>
                TAP TO EXPAND
              </div>
            </button>
          </div>
        )}
```

---

### Change 5: Add (or replace) canvas state in the main Workspace component

**If you already applied the earlier image-wiring prompt**, search for and **replace** these old lines:
```
  const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeCanvasVersion, setActiveCanvasVersion] = useState<ImageVersion | null>(null);
```
with:
```tsx
  const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeCanvasVersionId, setActiveCanvasVersionId] = useState<string | null>(null);
  const processedImageIds = useRef(new Set<string>());
```

**If you have NOT applied any image wiring yet**, find:
```
  const [activeCatch, setActiveCatch] = useState<CatchPayload | null>(null);
```
and add immediately after it:
```tsx
  const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeCanvasVersionId, setActiveCanvasVersionId] = useState<string | null>(null);
  const processedImageIds = useRef(new Set<string>());
```

---

### Change 6: Reset canvas state when project changes

Find the project-change reset useEffect. It looks like:
```tsx
  useEffect(() => {
    setMessages([]);
    setPlanStates(new Map());
    setPlanExecutions(new Map());
    setSessionId(null);
    setActiveCatch(null);
    priorLoaded.current = false;
    homePlanLoadedRef.current = false;
  }, [id]);
```

Add these four lines before `priorLoaded.current`:
```tsx
    setImageVersions([]);
    setCanvasOpen(false);
    setActiveCanvasVersionId(null);
    processedImageIds.current.clear();
```

---

### Change 7: Rehydrate imageB64 when loading prior messages from DB

Find the priorMessages useEffect that sets messages:
```tsx
    setMessages(
      priorMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        intentType: m.intentType,
        sentAt: m.createdAt,
      }))
    );
  }, [priorMessages]);
```

Change the `priorMessages.map(...)` to include imageB64 and imageMimeType:
```tsx
    setMessages(
      priorMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        intentType: m.intentType,
        sentAt: m.createdAt,
        imageB64: (m as any).imageB64 ?? undefined,
        imageMimeType: (m as any).imageMimeType ?? undefined,
      }))
    );
  }, [priorMessages]);
```

> This causes the existing image-collection useEffect (below) to pick up images from prior messages on page load.

---

### Change 8: Load persisted image versions from backend when session opens

Find:
```tsx
  // Collect images from chat messages into version history
  useEffect(() => {
```

Add immediately before it:
```tsx
  // Load persisted image versions from the backend when a session is known
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/image-versions`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data: any[] | null) => {
        if (cancelled || !data || data.length === 0) return;
        const loaded: ImageVersion[] = data.map((v) => ({
          id: `db-${v.id}`,
          dataUrl: `data:${v.imageMimeType ?? "image/png"};base64,${v.imageB64}`,
          prompt: v.prompt,
          createdAt: v.createdAt,
        }));
        setImageVersions(loaded);
        setActiveCanvasVersionId(loaded[loaded.length - 1].id);
        loaded.forEach((v) => processedImageIds.current.add(v.id));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

```

---

### Change 9: Add useEffect to collect images from messages into version history

Find:
```tsx
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatPending]);
```

Add before it:
```tsx
  // Collect images from chat messages into version history
  useEffect(() => {
    let latestNew: ImageVersion | null = null;
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.imageB64) {
        const versionId = msg.id ? `msg-${msg.id}` : `sent-${msg.sentAt ?? ""}`;
        if (!processedImageIds.current.has(versionId)) {
          processedImageIds.current.add(versionId);
          const version: ImageVersion = {
            id: versionId,
            dataUrl: `data:${msg.imageMimeType ?? "image/png"};base64,${msg.imageB64}`,
            createdAt: msg.sentAt ?? new Date().toISOString(),
          };
          setImageVersions((prev) => [...prev, version]);
          latestNew = version;
        }
      }
    }
    if (latestNew) {
      setActiveCanvasVersionId(latestNew.id);
      setCanvasOpen(true);
    }
  }, [messages]);

```

---

### Change 10: Add canvas handlers (handleOpenCanvas + handleCanvasRefine)

Find:
```tsx
  const handleCatchProceed = (msgId?: number) => {
```

Add before it:
```tsx
  const handleOpenCanvas = useCallback((dataUrl: string) => {
    const existing = imageVersions.find((v) => v.dataUrl === dataUrl);
    if (existing) {
      setActiveCanvasVersionId(existing.id);
    } else {
      const newId = `manual-${Date.now()}`;
      setImageVersions((prev) => [...prev, { id: newId, dataUrl, createdAt: new Date().toISOString() }]);
      setActiveCanvasVersionId(newId);
    }
    setCanvasOpen(true);
  }, [imageVersions]);

  const handleCanvasRefine = useCallback((prompt: string) => {
    if (!sessionId) return;
    const active = imageVersions.find((v) => v.id === activeCanvasVersionId);
    if (!active) {
      doSend(prompt, sessionId, messages);
      return;
    }
    const commaIdx = active.dataUrl.indexOf(",");
    const base64 = commaIdx >= 0 ? active.dataUrl.slice(commaIdx + 1) : "";
    const mimeMatch = active.dataUrl.match(/data:([^;]+)/);
    const mediaType = mimeMatch?.[1] ?? "image/png";
    doSend(prompt, sessionId, messages, undefined, { base64, mediaType });
  }, [sessionId, messages, imageVersions, activeCanvasVersionId, doSend]);

```

---

### Change 11: Pass onOpenCanvas to AssistantBubble

Find the `onAlertDismiss` prop in the AssistantBubble JSX call (the one inside the messages.map loop):
```tsx
                  onAlertDismiss={() => {
                    setMessages((prev) => prev.map((m) =>
                      m.id === msg.id ? { ...m, alertResolved: true } : m
                    ));
                  }}
                />
```

Change to:
```tsx
                  onAlertDismiss={() => {
                    setMessages((prev) => prev.map((m) =>
                      m.id === msg.id ? { ...m, alertResolved: true } : m
                    ));
                  }}
                  onOpenCanvas={handleOpenCanvas}
                />
```

---

### Change 12: Desktop split pane — show CanvasPanel when canvas is open

Find the desktop right panel `<div>` wrapper. It looks like:
```tsx
            <div style={{ flex: 1, minWidth: 240, overflow: "hidden" }}>
              <RightPanel
                projectId={id}
                entries={entries || []}
                activeCatch={activeCatch}
                onFileContext={setFileContext}
```

Replace the entire `<div>` (through its closing `</div>`) with this — **keep all your existing RightPanel props exactly as they are inside the else branch**:
```tsx
            <div style={{ flex: 1, minWidth: 240, overflow: "hidden" }}>
              {canvasOpen && imageVersions.length > 0 ? (
                <CanvasPanel
                  versions={imageVersions}
                  activeVersionId={activeCanvasVersionId}
                  onVersionSelect={setActiveCanvasVersionId}
                  onRefine={handleCanvasRefine}
                  onClose={() => setCanvasOpen(false)}
                  mode="inline"
                />
              ) : (
                <RightPanel
                  projectId={id}
                  entries={entries || []}
                  activeCatch={activeCatch}
                  onFileContext={setFileContext}
                  onLinkedRepoChange={setLinkedRepo}
                  pushHistory={pushHistory}
                  onRollbackPush={handleRollbackPush}
                  onHomeNav={() => setLocation("/home")}
                  forceTab={isMobile && mobileTab === "map" ? "map" : isMobile && mobileTab === "files" ? "files" : desktopForceTab}
                  onSendIntent={sendFromIntentCapture}
                  onFillIntent={(text) => { setInput(text); setTimeout(() => autoResize(), 0); }}
                  onMapReadinessChange={setMapReadiness}
                  displayedReadinessScore={displayedReadinessScore}
                  onSystemNodeMessage={pushSystemNodeMessage}
                  onHandover={handleHandover}
                  handoverPending={handoverPending}
                  lastHandoverHash={project?.lastHandoverHash ?? null}
                  isMobile={false}
                  resolvedNodeIds={pendingResolvedNodeIds}
                  onResolvedConsumed={() => setPendingResolvedNodeIds([])}
                  currentSnapshot={currentSnapshot}
                  onSnapshotChange={setCurrentSnapshot}
                  handoverOpen={handoverOpen}
                  onHandoverOpenChange={setHandoverOpen}
                  sandboxCode={sandboxCode}
                  onSandboxConsumed={() => setSandboxCode(null)}
                  previewRefreshTrigger={previewRefreshTrigger}
                  pendingTerminalCommand={pendingTerminalCommand}
                  onTerminalCommandConsumed={() => setPendingTerminalCommand(null)}
                  onCommandComplete={handleTerminalComplete}
                  wsLens={wsLens}
                  onOpenForge={() => setShowForgeExternal(true)}
                  externalForgeNodes={externalForgeNodes}
                  onForgeNodesConsumed={() => setExternalForgeNodes([])}
                  onForgeCompleted={() => void updateForgeState("forged")}
                />
              )}
            </div>
```

> **Note:** Your live repo's RightPanel may have slightly different props than this reference list — if a prop name doesn't exist in your version, skip it. The key addition is the `{canvasOpen && imageVersions.length > 0 ? ... : ...}` conditional wrapping the existing `<RightPanel>`.

---

### Change 13: Mobile canvas modal overlay

Find:
```tsx
      {isMobile && mobileTab !== "map" && (
        <MobileTabBar
```

Add before it:
```tsx
      {/* Mobile: full-screen Canvas Panel modal */}
      {isMobile && canvasOpen && imageVersions.length > 0 && (
        <CanvasPanel
          versions={imageVersions}
          activeVersionId={activeCanvasVersionId}
          onVersionSelect={setActiveCanvasVersionId}
          onRefine={handleCanvasRefine}
          onClose={() => setCanvasOpen(false)}
          mode="modal"
        />
      )}

```

### Change 14: Update `doSend` signature to accept `imageData`

Find the `doSend` `useCallback` declaration. It starts with something like:
```tsx
  const doSend = useCallback(
    (text: string, sid: number, currentMessages: ChatMessage[], ctx?: string | null) => {
```

If the last parameter does NOT already include `imageData`, update the signature line to add it:
```tsx
  const doSend = useCallback(
    (text: string, sid: number, currentMessages: ChatMessage[], ctx?: string | null, imageData?: { base64: string; mediaType: string }) => {
```

> **Skip this change** if `doSend` already has an `imageData` parameter — it won't need updating.

---

### Change 15: Pass `imageData` in the fetch body inside `doSend`

Inside `doSend`, find the body object that's passed to `fetch("/api/chat", ...)`. It will have several spread props. Find the closing section of that object, which looks like:
```tsx
        ...(userProfileStr ? { userProfile: userProfileStr } : {}),
        ...(projectMap ? { projectMap } : {}),
```

Add this line after `projectMap`:
```tsx
        ...(imageData ? { imageData } : {}),
```

> **Skip this change** if `imageData` is already being spread into the body.

---

### Change 16: Handle `imageB64` in the assistant message from the API response

Inside `doSend`, find the block where the assistant message is constructed after `fetch` resolves. It will include spreads like `...(res.plan ? ... : {})`. Add the image fields after the existing spreads:

```tsx
            ...(res.imageB64 ? { imageB64: res.imageB64, imageMimeType: res.imageMimeType } : {}),
            ...(res.imageGen?.images?.[0]?.imageUrl ? { imageB64: res.imageGen.images[0].imageUrl.split(",")[1], imageMimeType: res.imageGen.images[0].imageUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png" } : {}),
```

> **Skip this change** if you can already see `res.imageB64` being spread into the assistant message.

---

## Step 4 — Typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this does

- **Inline image rendering** — images appear inline in AssistantBubble with a "TAP TO EXPAND" badge, wrapped in a tappable button.
- **Canvas panel** — `CanvasPanel.tsx` shows the image full-size with a version history strip at the bottom and a refinement input.
- **Version history** — every new image Atlas generates is automatically added to the version strip. Thumbnails are clickable. Versions persist across session reloads via the backend.
- **Multi-turn refinement** — typing in the canvas panel sends the prompt to Atlas with the active image attached as base64 context. Atlas refines the image.
- **Desktop split pane** — when an image is generated the right panel switches to CanvasPanel automatically. Closing it restores the Decision Ledger.
- **Mobile modal** — on mobile, CanvasPanel opens as a full-screen overlay (z-index 200).
- **Proactive visual generation** — Atlas now proactively emits IMAGE_GEN when the conversation touches visual/aesthetic/spatial topics without being explicitly asked. (Backend change — already live in the deployed API.)
- **Refinement keywords** — IMAGE_REQUEST_RE in chat.ts updated to catch "refine", "improve", "redesign", "iterate", etc. so the auto-injection also fires on refinement requests.
