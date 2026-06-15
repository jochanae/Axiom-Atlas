# Foundation Mode: Route Home Chat to /api/chat

## What changed on the backend
The `/api/chat` endpoint now accepts requests with no `projectId`. When `projectId` is absent or null, it enters **Foundation mode** — a portfolio-wide view with all projects, their statuses, memories, and cross-project context injected into Atlas's system prompt.

This means the home screen chat no longer needs `/api/nexus/chat` — it can use the same `/api/chat` endpoint as the workspace, just without a projectId.

## What to change on the frontend

### 1. In the home screen chat component (wherever POST /api/nexus/chat is called)
Change the request to POST `/api/chat` instead. Remove `projectId` from the body (or set it to `null`/omit it entirely).

The new request body shape for Foundation mode:
```json
{
  "message": "...",
  "history": [...],
  "userProfile": "...",
  "model": "claude" | "gemini",
  "mode": "strategic" | "audit" | "deep-dive"
}
```

No `sessionId`, no `projectId`. That's it.

### 2. The SSE response format is identical to workspace chat
The home screen should already know how to parse workspace SSE responses (streaming tokens, `step` events, `done` event). The `done` event from Foundation mode has the same shape — no new fields required.

### 3. Keep /api/nexus/briefing for the briefing animation
Do NOT change the briefing endpoint. `GET /api/nexus/briefing` is a separate route that powers the cinematic portfolio summary animation on page load. Leave it untouched.

### 4. Keep /api/nexus/chat as a fallback for now
Do not delete `/api/nexus/chat` yet — leave it in place. Just route the active home chat to `/api/chat`. The old endpoint can be removed in a future cleanup pass.

### 5. Handle the NAVIGATE_TO token on the home screen
The Foundation mode response may include `NAVIGATE_TO:{"route":"/project/<id>"}` at the end of Atlas's content. The home screen should already handle this (the workspace does) — if not, add parsing: strip the token from displayed content and navigate to the given route when it appears.

## What NOT to change
- The workspace chat — it still uses `/api/chat` with a projectId. No changes there.
- The briefing, activity, or any other nexus endpoints.
- Session handling — Foundation mode has no session, so don't send sessionId.
- The focus chip or mode chip wiring — those can still be sent as `mode` in the body.

## Files to look in
- The home page component (`home.tsx` or similar)
- The API client or fetch utility that calls `/api/nexus/chat`
- Search for `nexus/chat` to find all call sites
