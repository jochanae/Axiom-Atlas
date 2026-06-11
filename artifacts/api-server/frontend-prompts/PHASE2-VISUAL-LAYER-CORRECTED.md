# Phase 2 — Visual Layer: Corrected Cursor Prompts for `atlas-idk`

> These prompts are calibrated to the **actual** `atlas-idk` codebase (not the drifted reference copy).
> Run `pnpm install` first if node_modules is missing.
> Apply prompts IN ORDER — each one builds on the previous.

---

## What this builds

When Atlas generates an image in chat:
1. The image renders inline in the AssistantBubble
2. Tapping it opens **CanvasPanel** (already exists in `src/components/CanvasPanel.tsx`) as the desktop right panel
3. Every new AI image auto-adds to CanvasPanel's **version history strip**
4. The **Refine** input in CanvasPanel sends a follow-up generation with the current image as context
5. On desktop: CanvasPanel replaces the right panel while images are active; close button restores it

---

## Prompt 1 — `src/components/workspace/AssistantBubble.tsx`

**What to change:** Add an optional `onOpenCanvas` prop. When the inline image is tapped, call it instead of opening the local expanded view.

Run `pnpm install` first if node_modules is missing. Then open `src/components/workspace/AssistantBubble.tsx`.

**Step 1 of 2 — Add prop to the type block.**

Find this exact block (it ends the props type, around line 1159):
```
  trustMode: "review" | "auto";
}) {
```

Replace with:
```
  trustMode: "review" | "auto";
  onOpenCanvas?: (imageSrc: string) => void;
}) {
```

**Step 2 of 2 — Add to destructuring AND wire to image tap.**

Find this exact line in the destructuring list (around line 1127):
```
  trustMode,
}: {
```

Replace with:
```
  trustMode,
  onOpenCanvas,
}: {
```

Then find the inline image tap button (around line 1523–1527):
```
            <button
              type="button"
              onClick={() => setImageExpanded(true)}
              aria-label="Expand generated visual"
              style={{ padding: 0, border: "none", background: "transparent", cursor: "zoom-in", display: "block", maxWidth: "100%" }}
            >
```

Replace with:
```
            <button
              type="button"
              onClick={() => {
                if (onOpenCanvas) {
                  onOpenCanvas(imageSrc);
                } else {
                  setImageExpanded(true);
                }
              }}
              aria-label="Expand generated visual"
              style={{ padding: 0, border: "none", background: "transparent", cursor: "zoom-in", display: "block", maxWidth: "100%" }}
            >
```

Do not change anything else. Run typecheck, push to main.

---

## Prompt 2 — `src/components/workspace/ChatStream.tsx`

**What to change:** Thread `onOpenCanvas` through `ChatStreamProps` so `workspace.tsx` can pass it down to every `AssistantBubble`.

Run `pnpm install` first if node_modules is missing. Then open `src/components/workspace/ChatStream.tsx`.

**Step 1 of 3 — Add prop to ChatStreamProps.**

Find this exact block near the end of the interface (around line 135–137):
```
  // push
  onPushSuccess: (records: PushRecordLike[]) => void;
}
```

Replace with:
```
  // push
  onPushSuccess: (records: PushRecordLike[]) => void;

  // canvas
  onOpenCanvas?: (imageSrc: string) => void;
}
```

**Step 2 of 3 — Add to destructuring.**

Find this exact block in the `ChatStream` function body (around line 152–159):
```
    onCatchProceed, onCatchAdjust, onPark, onCommit, onRegenerate, onSend,
    onPreviewCode, onRunCommand, onPrCreated, onExtractToForge, onForgeIntake, onReviewDiff,
    onOpenArtifact,
    onEditDeclined, onAlertDismiss, onStreamActivityUpdate, onStreamActivityComplete,
    onCommitCardDone, onSurfaceAction,
    planStates, planExecutions, onPlanStateChange, onPlanExecutionChange, onExecuteHomePlan,
    onPushSuccess,
  } = props;
```

Replace with:
```
    onCatchProceed, onCatchAdjust, onPark, onCommit, onRegenerate, onSend,
    onPreviewCode, onRunCommand, onPrCreated, onExtractToForge, onForgeIntake, onReviewDiff,
    onOpenArtifact,
    onEditDeclined, onAlertDismiss, onStreamActivityUpdate, onStreamActivityComplete,
    onCommitCardDone, onSurfaceAction,
    planStates, planExecutions, onPlanStateChange, onPlanExecutionChange, onExecuteHomePlan,
    onPushSuccess,
    onOpenCanvas,
  } = props;
```

**Step 3 of 3 — Pass to AssistantBubble.**

Find this exact line in the `<AssistantBubble>` render block (around line 277):
```
              onPushSuccess={onPushSuccess}
            />
```

Replace with:
```
              onPushSuccess={onPushSuccess}
              onOpenCanvas={onOpenCanvas}
            />
```

Do not change anything else. Run typecheck, push to main.

---

## Prompt 3 — `src/pages/workspace.tsx` (Part A: canvas state + handlers)

**What to change:** Import CanvasPanel, add 3 state variables + 1 ref, add 2 useEffects, add 2 callbacks.

Run `pnpm install` first if node_modules is missing. Then open `src/pages/workspace.tsx`.

**Step 1 of 5 — Add import.**

Find this existing import block (around line 80–82):
```
import { AssistantBubble } from "@/components/workspace/AssistantBubble";
import { ChatStream } from "@/components/workspace/ChatStream";
import { ChatComposer } from "@/components/workspace/ChatComposer";
```

Replace with:
```
import { AssistantBubble } from "@/components/workspace/AssistantBubble";
import { ChatStream } from "@/components/workspace/ChatStream";
import { ChatComposer } from "@/components/workspace/ChatComposer";
import { CanvasPanel } from "@/components/CanvasPanel";
import type { ImageVersion } from "@/components/CanvasPanel";
```

**Step 2 of 5 — Add canvas state + ref.**

Find this exact block (around line 3268–3270, right after the `useChatStream` destructure):
```
    doSend,
    handleRegenerate,
  } = useChatStream(id, {
```

Replace with:
```
    doSend,
    handleRegenerate,
  } = useChatStream(id, {
```

_(No change to that block — we're placing the new state AFTER the `useChatStream` call closes. Find the closing brace of the `useChatStream` call — it's the `});` that ends the options object passed to `useChatStream`. Place the following additions immediately after it.)_

After the closing `});` of the `useChatStream(id, { ... });` call, add:

```typescript
  // ── Canvas / image version state ───────────────────────────────────────
  const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeCanvasVersionId, setActiveCanvasVersionId] = useState<string | null>(null);
  const processedImageIds = useRef<Set<string>>(new Set());
```

**Step 3 of 5 — Auto-collect images from messages into version history.**

Find this existing reset effect (around line 3388–3400):
```
  // Reset workspace-owned chat state when the project changes.
  // (messages / sessionId / priorLoaded / historyMsgCountRef portion lives in useChatStream)
  useEffect(() => {
    setPlanStates(new Map());
    setPlanExecutions(new Map());
    setActiveCatch(null);
    setThinkingState(null);
    homePlanLoadedRef.current = false;
    // Note: abort/chatPending/activityStream reset is owned by useChatStream.
    // Reset auto-prime guards so a fresh ?source=handoff load can seed its first message.
    initialSent.current = false;
    importPrimed.current = false;
    homeHandoffPrimed.current = false;
    setAutoNameKey(0);
  }, [id]);
```

Replace with:
```
  // Reset workspace-owned chat state when the project changes.
  // (messages / sessionId / priorLoaded / historyMsgCountRef portion lives in useChatStream)
  useEffect(() => {
    setPlanStates(new Map());
    setPlanExecutions(new Map());
    setActiveCatch(null);
    setThinkingState(null);
    homePlanLoadedRef.current = false;
    // Note: abort/chatPending/activityStream reset is owned by useChatStream.
    // Reset auto-prime guards so a fresh ?source=handoff load can seed its first message.
    initialSent.current = false;
    importPrimed.current = false;
    homeHandoffPrimed.current = false;
    setAutoNameKey(0);
    // Reset canvas state when switching projects.
    setImageVersions([]);
    setCanvasOpen(false);
    setActiveCanvasVersionId(null);
    processedImageIds.current.clear();
  }, [id]);

  // Collect AI-generated images from chat messages into the canvas version history.
  useEffect(() => {
    let latestNew: ImageVersion | null = null;
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.imageB64) {
        const versionId = msg.id ? `msg-${msg.id}` : `pending-${msg.sentAt ?? Date.now()}`;
        if (!processedImageIds.current.has(versionId)) {
          processedImageIds.current.add(versionId);
          const version: ImageVersion = {
            id: versionId,
            imageUrl: `data:${msg.imageMimeType ?? "image/png"};base64,${msg.imageB64}`,
            prompt: "",
            model: msg.modelUsed ?? "",
            mode: "render",
            timestamp: msg.sentAt ?? new Date().toISOString(),
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

**Step 4 of 5 — Add `handleOpenCanvas` callback.**

Find this existing callback (it's near where `doSend` callbacks live — search for `handleRegenerate` which comes from useChatStream or a nearby `useCallback`). Add the two new callbacks somewhere in the callbacks section, before the JSX return.

Add these two callbacks anywhere in the callbacks/handlers section (e.g. near `handlePark`, `handleCommit`, etc.):

```typescript
  const handleOpenCanvas = useCallback((imageSrc: string) => {
    const existing = imageVersions.find((v) => v.imageUrl === imageSrc);
    if (existing) {
      setActiveCanvasVersionId(existing.id);
    } else {
      const versionId = `tap-${Date.now()}`;
      const version: ImageVersion = {
        id: versionId,
        imageUrl: imageSrc,
        prompt: "",
        model: "",
        mode: "render",
        timestamp: new Date().toISOString(),
      };
      processedImageIds.current.add(versionId);
      setImageVersions((prev) => [...prev, version]);
      setActiveCanvasVersionId(versionId);
    }
    setCanvasOpen(true);
  }, [imageVersions]);

  const handleCanvasRefine = useCallback((prompt: string) => {
    const active = imageVersions.find((v) => v.id === activeCanvasVersionId);
    if (!active || !sessionId) return;
    const match = active.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;
    const [, mediaType, base64] = match;
    doSend(prompt, sessionId, messagesRef.current, undefined, { base64, mediaType });
  }, [activeCanvasVersionId, imageVersions, sessionId, doSend]);
```

**Step 5 of 5 — Add deps to useCallback.**

Make sure `useCallback` is already imported from `"react"` at the top of the file (it already is — it's in the existing import at line 1).

Do not change anything else. Run typecheck, push to main.

---

## Prompt 4 — `src/pages/workspace.tsx` (Part B: JSX wiring)

**What to change:** (1) Pass `onOpenCanvas` through `chatStreamProps`. (2) Make the OUTER `flowPanel` show `CanvasPanel` when images are active, `RightPanel` otherwise.

Run `pnpm install` first if node_modules is missing. Then open `src/pages/workspace.tsx`.

**Step 1 of 2 — Add `onOpenCanvas` to `chatStreamProps`.**

Find this exact line near the END of the `chatStreamProps` object (around line 6265):
```
              onPushSuccess: handleReviewPushSuccess,
            } : null}
```

Replace with:
```
              onPushSuccess: handleReviewPushSuccess,
              onOpenCanvas: handleOpenCanvas,
            } : null}
```

**Step 2 of 2 — Make `flowPanel` conditional.**

Find the OUTER `UnifiedConversationSurface` `flowPanel` prop (around line 5968). It looks like this:
```
        flowPanel={!isMobile ? (
          <RightPanel
```

And ends (many lines later) with:
```
          />
        ) : undefined}
```

The entire `flowPanel={...}` prop spans from `flowPanel={!isMobile ? (` through `) : undefined}`. Replace the entire prop with:

```
        flowPanel={!isMobile ? (
          canvasOpen && imageVersions.length > 0 ? (
            <CanvasPanel
              open={true}
              versions={imageVersions}
              activeVersionId={activeCanvasVersionId ?? ""}
              onSelectVersion={setActiveCanvasVersionId}
              onRefine={handleCanvasRefine}
              onClose={() => setCanvasOpen(false)}
              isGenerating={chatPending}
              theme={termTheme === "parchment" ? "light" : "dark"}
              mode="inline"
            />
          ) : (
            <RightPanel
```
_(then the full existing RightPanel with all its props, exactly as it was)_
```
            />
          )
        ) : undefined}
```

In other words: wrap the existing `<RightPanel ... />` in a ternary — show `CanvasPanel` when `canvasOpen && imageVersions.length > 0`, otherwise show RightPanel. Do not change any of the RightPanel props.

Do not change anything else. Run typecheck, push to main.

---

## Backend: already done

`artifacts/api-server/src/routes/chat.ts` already has:
- `IMAGE_REQUEST_RE` includes `refine|improve|update|redesign|iterate|adjust|rework|tweak|modify|enhance`
- **Proactive Visual Generation** system prompt section — Atlas emits `IMAGE_GEN` when the conversation is visual/aesthetic/spatial without being explicitly asked
- `imageData` passthrough from request body → Anthropic/Gemini API call

No backend changes needed.

---

## After applying all 4 prompts

1. Open a workspace in the live app
2. Ask Atlas: _"sketch the homepage layout for my app"_ or _"what should the onboarding screen look like?"_
3. Atlas emits IMAGE_GEN → backend generates image → `imageB64` returned
4. Image renders inline in chat; tapping it opens CanvasPanel in the right panel
5. Type in the Refine input (e.g. _"make it darker, more minimal"_) → new generation → new thumbnail in the strip
6. Click thumbnails to compare versions
7. Click ✕ in CanvasPanel to return to the Ledger/Files right panel
