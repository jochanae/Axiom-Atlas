# Phase 2 — Visual Layer: Cursor Prompts
## Inline images · Canvas Panel · Version history · Refinement · Desktop split pane

Run `pnpm install` first if node_modules is missing.
Apply each prompt in order. Run typecheck and push to main after the final prompt.

---

## PROMPT 1 — Create CanvasPanel component (new file)

**File:** `src/components/CanvasPanel.tsx`
**Action:** Create this file from scratch. Full content below.

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

Do not change anything else. Run typecheck after.

---

## PROMPT 2 — workspace.tsx: Add imports + ChatMessage fields

**File:** `src/pages/workspace.tsx`
**Action:** Make 2 targeted additions.

### Addition 1 — Import CanvasPanel

Find this block near the top of the file (after existing component imports):

```tsx
import { useThemeMode } from "@/lib/theme";
```

Add these two lines immediately after it:

```tsx
import { CanvasPanel } from "../components/CanvasPanel";
import type { ImageVersion } from "../components/CanvasPanel";
```

### Addition 2 — Add imageB64 + imageMimeType to ChatMessage type

Find the `ChatMessage` type / interface definition. It will have fields like `role`, `content`, `id`. Add these two optional fields inside it (alongside the other optional fields):

```ts
imageB64?: string;
imageMimeType?: string;
```

Do not change anything else. Run typecheck after.

---

## PROMPT 3 — workspace.tsx: Add onOpenCanvas to AssistantBubble

**File:** `src/pages/workspace.tsx`
**Action:** 3 additions to the `AssistantBubble` component.

### Addition 1 — Add prop to destructure list

Find the destructure list for `AssistantBubble`. It will end with something like:

```tsx
  onAlertDismiss,
}: {
```

Change it to:

```tsx
  onAlertDismiss,
  onOpenCanvas,
}: {
```

### Addition 2 — Add prop to type definition

Inside the `AssistantBubble` props type block, find:

```ts
  onAlertDismiss?: () => void;
```

Add immediately after:

```ts
  onOpenCanvas?: (dataUrl: string) => void;
```

### Addition 3 — Add inline image rendering inside AssistantBubble JSX

Inside the AssistantBubble return, find the section that renders `memoryChips` (look for `message.memoryChips` or `MemoryChip`). The image block goes **after** that section and **before** whatever comes next (autoFetchedFiles, content blocks, etc.).

Add this block:

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

Do not change anything else. Run typecheck after.

---

## PROMPT 4 — workspace.tsx: State, effects, and callbacks

**File:** `src/pages/workspace.tsx`
**Action:** Add canvas state, version-history effects, and refine callbacks inside the main workspace component.

### Addition 1 — State variables

Find the block of `useState` calls near the top of the main workspace component. They will include things like `sessionId`, `activeCatch`, etc. Add these 3 lines alongside them (order doesn't matter):

```tsx
const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
const [canvasOpen, setCanvasOpen] = useState(false);
const [activeCanvasVersionId, setActiveCanvasVersionId] = useState<string | null>(null);
const processedImageIds = useRef(new Set<string>());
```

### Addition 2 — useEffect: Collect images from chat messages into version history

Find the existing `useEffect` block that fires when `messages` changes (it likely calls `scrollIntoView` or similar). Add this **new** `useEffect` immediately before or after it:

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

### Addition 3 — handleOpenCanvas + handleCanvasRefine callbacks

Find the section where callback functions like `handlePark`, `handleCommit`, or similar are defined. Add these two callbacks in that area:

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

> **Note:** `doSend` must accept a 5th argument `imageData?: { base64: string; mediaType: string }`. If your `doSend` doesn't have this parameter yet, add it to its signature and pass it through to the API request body as `imageData`.

Do not change anything else. Run typecheck after.

---

## PROMPT 5 — workspace.tsx: Wire onOpenCanvas into AssistantBubble usage

**File:** `src/pages/workspace.tsx`
**Action:** Pass the new prop when AssistantBubble is rendered.

Find the place in the JSX where `<AssistantBubble` is rendered with its props. It will have props like `onPark`, `onCommit`, `onRegenerate`. Add this prop anywhere in that list:

```tsx
onOpenCanvas={handleOpenCanvas}
```

Do not change anything else. Run typecheck after.

---

## PROMPT 6 — workspace.tsx: Desktop split pane — CanvasPanel replaces RightPanel when images exist

**File:** `src/pages/workspace.tsx`
**Action:** On desktop, when the canvas is open and images exist, show CanvasPanel in the right pane instead of RightPanel.

Find the desktop right-pane section. It will contain a `<div>` that wraps `<RightPanel`. The RightPanel will have many props (entries, activeCatch, onFileContext, etc.).

Replace the **outer wrapper div** that contains `<RightPanel` (on desktop) with this conditional:

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
      {/* keep all existing RightPanel props exactly as they are */}
    />
  )}
</div>
```

Keep every existing RightPanel prop unchanged inside the `else` branch. Only wrap the outer div with the conditional. Do not change anything else. Run typecheck after.

---

## PROMPT 7 — workspace.tsx: Mobile full-screen Canvas Panel modal

**File:** `src/pages/workspace.tsx`
**Action:** On mobile, render CanvasPanel as a full-screen modal overlay when images exist and canvas is open.

Find the section near the bottom of the main workspace JSX where `{isMobile && ...` conditionals are rendered (e.g., `MobileTabBar`). Add this block immediately **before** the MobileTabBar conditional:

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

Do not change anything else. Run typecheck, push to main.

---

## Backend changes (already live in Cloud Run)

These are already deployed — no action needed:

- **`chat.ts` — IMAGE_REQUEST_RE** now includes refinement keywords (`refine|improve|update|redesign|iterate|adjust|rework|tweak|modify|enhance`) so multi-turn image refinement auto-triggers correctly.
- **`chat.ts` — Proactive Visual Generation** added to system prompt: Atlas auto-emits `IMAGE_GEN` when conversation touches visual/aesthetic/design terrain without an explicit request.
- **`chat.ts` — imageData passthrough** already wired: `POST /api/chat` accepts `{ imageData: { base64, mediaType } }` and sends it to both Claude and Gemini for vision-based refinement.

---

## What the full flow looks like once applied

1. User asks Atlas to design something → Atlas emits `IMAGE_GEN` token → backend generates image → response includes `imageB64`
2. `AssistantBubble` renders image inline with "TAP TO EXPAND" badge
3. User taps → `handleOpenCanvas` → `canvasOpen = true`, `imageVersions` updated
4. On mobile: full-screen `CanvasPanel` appears. On desktop: right pane switches from Decision Ledger to CanvasPanel
5. User types in the refine input → `handleCanvasRefine` extracts base64 from active version → calls `doSend` with `imageData`
6. Backend sees the refinement request + image → Claude/Gemini see the image → new `IMAGE_GEN` emitted → new image appears → `useEffect` auto-adds it to `imageVersions` → version strip shows v1, v2…
