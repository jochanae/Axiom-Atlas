# Prompt 1 of 3 — useChatStream: support "All Projects" (global) mode

## File
`src/hooks/useChatStream.ts`

## The change — ONE LINE only

Find (around line 380-382):
```ts
      const body = {
        sessionId: sid,
        projectId,
```

Replace with:
```ts
      const body = {
        sessionId: sid,
        ...(projectId ? { projectId } : {}),
```

## Why
When `projectId` is 0 (global mode), this stops sending it to the backend.
The backend treats a missing `projectId` as foundation mode — Atlas answers
from the full portfolio instead of a single project. When `projectId` is a
real number (normal workspace), nothing changes.

## Do not change anything else.
## Run typecheck, push to main.
