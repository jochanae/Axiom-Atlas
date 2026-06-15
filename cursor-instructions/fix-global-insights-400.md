# Fix: Global Insights returns HTTP 400

## Problem
`useNexusChatStream.ts` calls `/api/chat` (the workspace endpoint).
That endpoint requires `sessionId` and `projectId` — which Global Insight never has.
Result: every Global Insight message returns 400 immediately.

## File
`src/hooks/useNexusChatStream.ts`

## Find this block (around line 330-347):
```ts
    try {
      await stream({
        endpoint: "/api/chat",
        body: {
          message: routedText,
          history,
          userProfile,
          model: resolvedModel,
          mode: resolvedMode,
          ...(imgAttachments.length > 0
            ? {
                attachments: imgAttachments,
                // Legacy fields for pre-multi-image backend builds.
                imageData: firstImg!.base64,
                imageMimeType: firstImg!.mediaType,
              }
            : {}),
        },
```

## Replace with:
```ts
    try {
      await stream({
        endpoint: "/api/nexus/chat",
        body: {
          message: routedText,
          history,
          userProfile,
          model: resolvedModel,
          mode: resolvedMode,
          conversationId: activeConversationIdRef.current ?? undefined,
          focusProjectId: focusProjectId ?? undefined,
          ...(imgAttachments.length > 0
            ? {
                attachments: imgAttachments,
                imageBase64: firstImg!.base64,
                imageMimeType: firstImg!.mediaType,
              }
            : {}),
        },
```

## What changed
- `endpoint` → `/api/nexus/chat` (correct home/global endpoint)
- Added `conversationId` → so the Living Thread persists across messages
- Added `focusProjectId` → so Atlas knows which project is in focus
- Renamed `imageData` → `imageBase64` to match what `/api/nexus/chat` actually reads

## Do not change anything else.
## Run typecheck, push to main.
