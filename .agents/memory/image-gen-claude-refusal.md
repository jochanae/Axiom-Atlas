---
name: Claude image generation refusal
description: Why Claude refuses IMAGE_GEN tokens and how to frame the system prompt correctly
---

## The Rule
Never tell Claude "YOU CAN generate images" in a system prompt. Claude knows this is false (it cannot natively produce images) and its safety training overrides the instruction — it refuses every time regardless of how forcefully the prompt insists.

**Why:** Claude's RLHF training is deeply resistant to claiming capabilities it doesn't have. The stronger the insistence, the harder it pushes back.

**How to apply:** Frame IMAGE_GEN as an *external service the backend calls*. The honest framing is: "An image generation service (Gemini) is connected to this backend. You trigger it by emitting a token. You are the prompt author, not the image generator." Claude cooperates because this is true — it emits text, the backend calls Gemini.

## The Auto-Inject Fallback
`IMAGE_REQUEST_RE` in `chat.ts` auto-injects an IMAGE_GEN token even if Claude doesn't emit one. The original regex required TWO matching words (verb + visual noun), which missed natural phrases like "sketch a heart" or "draw me X".

Fix: artistic verbs alone (sketch, draw, render, paint, illustrate) are sufficient — don't require a second noun. Updated regex uses `|` to separate the "artistic verb alone" path from the "generic verb + visual noun" path.

## Standalone Image Generator
`POST /api/image/generate` accepts `{ prompt }`, returns `{ b64_json, mimeType, text }`. Registered with `requireAuth` in `routes/index.ts`. Frontend calls it directly — no Atlas AI loop involved. This is the reliable path when the token approach has issues.
