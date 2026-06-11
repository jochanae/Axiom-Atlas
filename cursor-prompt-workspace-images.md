# Cursor Prompt — Wire Image Generation to Workspace

Run `pnpm install` first if node_modules is missing.

File: `src/pages/workspace.tsx`

Make **4 changes** to this file. Do not change anything else.

---

## Change 1 — Add CanvasPanel import

Find this line:
```
import { McpPanel } from "@/components/workspace/McpPanel";
```

Add one line directly after it:
```
import { CanvasPanel, type ImageVersion } from "../components/CanvasPanel";
```

---

## Change 2 — Add state variables

Find this exact text:
```
  const [pendingResolvedNodeIds, setPendingResolvedNodeIds] = useState<string[]>([]);
  const [fileContext, setFileContext] = useState<string | null>(null);
```

Replace it with:
```
  const [pendingResolvedNodeIds, setPendingResolvedNodeIds] = useState<string[]>([]);
  const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeCanvasVersion, setActiveCanvasVersion] = useState<ImageVersion | null>(null);
  const [fileContext, setFileContext] = useState<string | null>(null);
```

---

## Change 3 — Add useEffect to collect images + fix mapPriorMessage

Find this exact text in the `mapPriorMessage` callback inside `useChatStream(...)`:
```
        costUsd: raw.costUsd != null ? Number(raw.costUsd) : raw.cost_usd != null ? Number(raw.cost_usd) : null,
      };
    },
    entries,
```

Replace it with:
```
        costUsd: raw.costUsd != null ? Number(raw.costUsd) : raw.cost_usd != null ? Number(raw.cost_usd) : null,
        imageB64: (raw as Record<string, unknown>).imageB64 as string | undefined ?? (raw as Record<string, unknown>).image_b64 as string | undefined,
        imageMimeType: (raw as Record<string, unknown>).imageMimeType as string | undefined ?? (raw as Record<string, unknown>).image_mime_type as string | undefined,
      };
    },
    entries,
```

Then find this block:
```
  useEffect(() => {
    if (messages.length > 0 || greetingLoading || atlasGreeting) return;
```

Add this new `useEffect` DIRECTLY BEFORE that block:
```
  // Collect generated images from chat into version history for CanvasPanel
  useEffect(() => {
    const newImages = messages.filter(
      (m): m is typeof m & { imageB64: string } => m.role === "assistant" && !!m.imageB64
    );
    if (newImages.length === 0) return;
    setImageVersions((prev) => {
      const existingIds = new Set(prev.map((v) => v.id));
      const toAdd = newImages
        .filter((m) => !existingIds.has(m.id?.toString() ?? ""))
        .map((m) => ({
          id: m.id?.toString() ?? Math.random().toString(36).slice(2),
          imageUrl: `data:${m.imageMimeType ?? "image/png"};base64,${m.imageB64}`,
          prompt: m.content.slice(0, 120),
          model: (m as Record<string, unknown>).model as string ?? "unknown",
          mode: "render" as const,
          timestamp: m.sentAt ?? new Date().toISOString(),
        }));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, [messages]);

```

---

## Change 4 — Render CanvasPanel in JSX

Find this exact text near the end of the component's JSX return:
```
      {showVault && (
        <VisualVault
          projectId={id}
          onClose={() => setShowVault(false)}
        />
      )}
```

Add this BEFORE that block:
```
      {canvasOpen && activeCanvasVersion && (
        <CanvasPanel
          versions={imageVersions}
          activeVersionId={activeCanvasVersion.id}
          onVersionSelect={(v) => setActiveCanvasVersion(v)}
          onRefine={(prompt) => {
            setCanvasOpen(false);
            const base64 = activeCanvasVersion.imageUrl.split(",")[1] ?? "";
            const mediaType = activeCanvasVersion.imageUrl.startsWith("data:image/jpeg")
              ? "image/jpeg"
              : "image/png";
            void doSend(prompt, sessionId, messages, null, { base64, mediaType });
          }}
          onClose={() => setCanvasOpen(false)}
          mode="modal"
        />
      )}
```

---

## After making all changes

Run typecheck and fix any errors:
```
pnpm --filter @workspace/atlas run typecheck
```

Then push to main.

---

## Also: Neon SQL (run in Neon SQL editor — production database)

```sql
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS "image_b64" text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS "image_mime_type" text;
```

---

## What this does

- `useChatStream` already extracts `imageB64` from the SSE `done` event — that part works
- `mapPriorMessage` now maps `image_b64` from the DB so images show on reload
- The `useEffect` collects all images from `messages` into `imageVersions`
- `CanvasPanel` renders as a modal when `canvasOpen` is true
- Tapping the image in `AssistantBubble` already shows an expanded modal — to also open `CanvasPanel`, add a button near the image: `onClick={() => { setActiveCanvasVersion(imageVersions.find(v => v.id === msg.id?.toString()) ?? imageVersions[imageVersions.length - 1] ?? null); setCanvasOpen(true); }}`
